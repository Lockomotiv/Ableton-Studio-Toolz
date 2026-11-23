// Essensplan (Woche) und Rezepte – Zutaten wandern auf Knopfdruck auf die Einkaufsliste.
//   meals   { date, slot: 'breakfast'|'lunch'|'dinner', title, recipeId, emoji }
//   recipes { title, emoji, servings, ingredients: "eine Zutat pro Zeile", steps, url, tags }
import { h, icon, toast, sheet, confirmSheet, fmt } from './ui.js';
import { store } from './store.js';
import { today, childMode } from './domain.js';
import { ymd, addDays, shoppingCategory } from './nlp.js';
import { haptic, openUrl } from './native.js';

export const SLOTS = { breakfast: ['Frühstück', '🥐'], lunch: ['Mittag', '🍝'], dinner: ['Abend', '🍲'] };
const FOOD_EMOJI = ['🍝', '🍕', '🥗', '🍲', '🍛', '🌮', '🍔', '🥘', '🍜', '🐟', '🍗', '🥞', '🥪', '🍳', '🥦', '🍰'];

function weekStart(d) { const x = fmt.parse(d); const off = (x.getDay() + 6) % 7; return ymd(addDays(x, -off)); }
export function mealsOn(date) { return store.list('meals').filter((m) => m.date === date).sort((a, b) => Object.keys(SLOTS).indexOf(a.slot) - Object.keys(SLOTS).indexOf(b.slot)); }
function mealAt(date, slot) { return store.list('meals').find((m) => m.date === date && m.slot === slot); }
export function recipe(id) { return store.get('recipes', id); }

export function ingredientLines(r) {
  return String(r?.ingredients || '').split('\n').map((s) => s.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
}
/** "500 g Hackfleisch" → "Hackfleisch" (für Duplikat-Erkennung) */
function coreName(s) { return s.toLowerCase().replace(/^[\d.,/½¼¾\s]+(g|kg|ml|l|el|tl|stk\.?|stück|prise|pck\.?|packung|dose[n]?|bund|becher|zehe[n]?|scheibe[n]?|glas)?\.?\s+/i, '').trim(); }

export function addIngredientsToShopping(recipes) {
  const open = store.list('shopping').filter((s) => !s.done).map((s) => coreName(s.name));
  const fresh = [];
  for (const r of recipes) for (const line of ingredientLines(r)) {
    const core = coreName(line);
    if (!core || open.includes(core) || fresh.some((f) => coreName(f.name) === core)) continue;
    fresh.push({ name: line, category: shoppingCategory(core), done: false, note: r.title });
  }
  if (fresh.length) store.putMany('shopping', fresh);
  return fresh.length;
}

const state = { week: null, slots: null };
export function viewMeals() {
  if (!state.week) state.week = weekStart(today());
  const slots = store.config.mealSlots || ['lunch', 'dinner'];
  const page = h('div.subpage');
  const rerender = () => page.replaceWith(viewMeals());
  const days = [...Array(7)].map((_, i) => ymd(addDays(fmt.parse(state.week), i)));
  const kw = isoWeek(fmt.parse(state.week));
  page.append(h('div.date-switch', null,
    h('button.icon-btn', { 'aria-label': 'Vorige Woche', onclick: () => { state.week = ymd(addDays(fmt.parse(state.week), -7)); rerender(); } }, icon('left')),
    h('b', null, `KW ${kw} · ${fmt.parse(days[0]).getDate()}.–${fmt.parse(days[6]).getDate()}. ${fmt.MO[fmt.parse(days[6]).getMonth()].slice(0, 3)}`),
    h('button.icon-btn', { 'aria-label': 'Nächste Woche', onclick: () => { state.week = ymd(addDays(fmt.parse(state.week), 7)); rerender(); } }, icon('right'))));

  const grid = h('div.meal-week');
  for (const d of days) {
    const dt = fmt.parse(d);
    grid.append(h('div.meal-day' + (d === today() ? '.today' : ''), null,
      h('div.md-head', null, h('b', null, fmt.WD[dt.getDay()]), h('span', null, dt.getDate() + '.')),
      ...slots.map((slot) => {
        const m = mealAt(d, slot);
        const r = m?.recipeId ? recipe(m.recipeId) : null;
        return h('button.meal-slot' + (m ? '.set' : ''), { onclick: () => !childMode() && editMeal(d, slot, m) },
          h('small', null, SLOTS[slot][0]),
          m ? h('span.ms-title', null, (m.emoji || r?.emoji || SLOTS[slot][1]) + ' ' + m.title) : h('span.ms-empty', null, childMode() ? '–' : '+'));
      })));
  }
  page.append(grid);
  if (!childMode()) {
    const weekRecipes = store.list('meals').filter((m) => m.date >= days[0] && m.date <= days[6] && m.recipeId).map((m) => recipe(m.recipeId)).filter(Boolean);
    page.append(h('div.btn-col', null,
      h('button.btn.tonal', { disabled: !weekRecipes.length, onclick: () => { const n = addIngredientsToShopping(weekRecipes); toast(n ? `${n} Zutaten auf die Einkaufsliste gesetzt` : 'Alles schon auf der Liste'); } }, icon('cart', 18), 'Zutaten der Woche auf die Einkaufsliste'),
      h('div.chips', null, h('span.muted', null, 'Mahlzeiten:'), ...Object.entries(SLOTS).map(([k, [l, e]]) => h('button.chip' + (slots.includes(k) ? '.removable' : ''), { onclick: () => {
        const next = slots.includes(k) ? slots.filter((x) => x !== k) : [...slots, k].sort((a, b) => Object.keys(SLOTS).indexOf(a) - Object.keys(SLOTS).indexOf(b));
        if (next.length) { store.saveConfig({ mealSlots: next }); }
      } }, e + ' ' + l)))));
  }
  return page;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}

export function editMeal(date, slot, m) {
  let input;
  const recipes = store.list('recipes').sort((a, b) => a.title.localeCompare(b.title));
  const recent = [...new Map(store.list('meals').filter((x) => !x.recipeId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((x) => [x.title.toLowerCase(), x])).values()].slice(0, 8);
  const save = (s, data) => { store.put('meals', { ...(m || {}), date, slot, ...data }); haptic('success'); s.close(); };
  sheet((s) => h('div.sheet-body', null,
    h('h2.sheet-title', null, `${SLOTS[slot][1]} ${SLOTS[slot][0]} · ${fmt.dayLabel(date)}`),
    h('form.addbar', { onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t) save(s, { title: t, recipeId: null, emoji: null }); } },
      input = h('input', { value: m && !m.recipeId ? m.title : '', placeholder: 'Was gibt es? z. B. Pfannkuchen', autofocus: true }),
      h('button.icon-btn.primary', { type: 'submit', 'aria-label': 'Speichern' }, icon('check'))),
    recipes.length ? h('h3.section-title', null, 'Aus den Rezepten') : null,
    recipes.length ? h('div.pick-grid', null, ...recipes.map((r) => h('button.pick' + (m?.recipeId === r.id ? '.on' : ''), { onclick: () => save(s, { title: r.title, recipeId: r.id, emoji: r.emoji }) }, h('span', null, r.emoji || '🍽️'), r.title))) : null,
    recent.length ? h('h3.section-title', null, 'Zuletzt') : null,
    recent.length ? h('div.chips', null, ...recent.map((x) => h('button.chip', { onclick: () => save(s, { title: x.title, recipeId: null, emoji: x.emoji }) }, x.title))) : null,
    h('div.btn-row', null,
      m ? h('button.btn.danger-ghost', { onclick: () => { store.del('meals', m.id); s.close(); } }, icon('trash', 18), 'Leeren') : h('span'),
      h('button.btn.ghost', { onclick: () => { s.close(); editRecipe(null); } }, icon('plus', 18), 'Neues Rezept'))), { tall: true, label: 'Mahlzeit' });
}

// ---------- Rezepte ----------
const rstate = { q: '' };
export function viewRecipes() {
  const page = h('div.subpage');
  const all = store.list('recipes').sort((a, b) => a.title.localeCompare(b.title));
  const q = rstate.q.toLowerCase();
  const list = q ? all.filter((r) => (r.title + ' ' + (r.tags || '') + ' ' + (r.ingredients || '')).toLowerCase().includes(q)) : all;
  let search;
  page.append(h('div.addbar', null,
    search = h('input', { value: rstate.q, placeholder: 'Rezept oder Zutat suchen', type: 'search', oninput: (e) => { rstate.q = e.target.value; const n = viewRecipes(); page.replaceWith(n); const i = n.querySelector('input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }),
    childMode() ? null : h('button.icon-btn.primary', { 'aria-label': 'Neues Rezept', onclick: () => editRecipe(null) }, icon('plus'))));
  if (!all.length) page.append(h('div.card.tip', null, h('b', null, 'Rezeptsammlung'), h('p', null, 'Lieblingsgerichte mit Zutaten speichern, im Essensplan einplanen und die Zutaten mit einem Tipp auf die Einkaufsliste setzen.'), childMode() ? null : h('button.btn.tonal', { onclick: () => editRecipe(null) }, icon('plus', 18), 'Erstes Rezept')));
  page.append(h('div.recipe-grid', null, ...list.map((r) => h('button.recipe-card', { onclick: () => showRecipe(r) },
    h('span.rc-emoji', null, r.emoji || '🍽️'), h('b', null, r.title), h('small', null, `${ingredientLines(r).length} Zutaten${r.servings ? ' · ' + r.servings + ' Pers.' : ''}`)))));
  void search;
  return page;
}

function showRecipe(r) {
  const lines = ingredientLines(r);
  sheet((s) => h('div.sheet-body', null,
    h('div.recipe-hero', null, h('span', null, r.emoji || '🍽️'), h('h2.sheet-title', null, r.title)),
    r.servings ? h('p.muted', null, `Für ${r.servings} Personen`) : null,
    lines.length ? h('section.section', null, h('h3.section-title', null, 'Zutaten'), h('ul.ingredients', null, ...lines.map((l) => h('li', null, l)))) : null,
    r.steps ? h('section.section', null, h('h3.section-title', null, 'Zubereitung'), h('p.prewrap', null, r.steps)) : null,
    r.url ? h('button.btn.ghost', { onclick: () => openUrl(r.url) }, icon('external', 18), 'Originalrezept') : null,
    childMode() ? null : h('div.btn-col', null,
      h('button.btn.primary', { onclick: () => { s.close(); planRecipe(r); } }, icon('calendar', 18), 'Im Essensplan einplanen'),
      h('button.btn.tonal', { onclick: () => { const n = addIngredientsToShopping([r]); toast(n ? `${n} Zutaten auf die Liste` : 'Alles schon auf der Liste'); } }, icon('cart', 18), 'Zutaten auf die Einkaufsliste'),
      h('button.btn.ghost', { onclick: () => { s.close(); editRecipe(r); } }, icon('edit', 18), 'Bearbeiten'))), { tall: true, label: r.title });
}

function planRecipe(r) {
  const days = [...Array(10)].map((_, i) => ymd(addDays(new Date(), i)));
  let slot = (store.config.mealSlots || ['lunch', 'dinner']).slice(-1)[0];
  sheet((s) => {
    const slotRow = h('div.seg', null, ...Object.entries(SLOTS).map(([k, [l]]) => h('button.seg-btn' + (k === slot ? '.on' : ''), { onclick: (e) => { slot = k; [...e.target.parentNode.children].forEach((c) => c.classList.toggle('on', c === e.target)); } }, l)));
    return h('div.sheet-body', null, h('h2.sheet-title', null, `${r.title} einplanen`), slotRow,
      h('div.pick-grid', null, ...days.map((d) => h('button.pick', { onclick: () => { store.put('meals', { ...(mealAt(d, slot) || {}), date: d, slot, title: r.title, recipeId: r.id, emoji: r.emoji }); s.close(); toast(`${r.title}: ${fmt.dayLabel(d)}, ${SLOTS[slot][0]}`); } }, fmt.dayLabel(d)))));
  }, { label: 'Einplanen' });
}

export function editRecipe(r) {
  const v = { title: '', emoji: '🍝', servings: 4, ingredients: '', steps: '', url: '', tags: '', ...(r || {}) };
  const f = {};
  let emoji = v.emoji;
  const ems = h('div.emojis');
  const drawE = () => ems.replaceChildren(...FOOD_EMOJI.map((e) => h('button.emoji' + (e === emoji ? '.on' : ''), { type: 'button', onclick: () => { emoji = e; drawE(); } }, e)));
  drawE();
  const field = (label, input) => h('label.field', null, h('span', null, label), input);
  sheet((s) => h('form.sheet-body', { onsubmit: (e) => {
    e.preventDefault();
    const title = f.title.value.trim(); if (!title) return;
    store.put('recipes', { ...(r || {}), title, emoji, servings: +f.servings.value || null, ingredients: f.ing.value.trim(), steps: f.steps.value.trim(), url: f.url.value.trim(), tags: f.tags.value.trim() });
    s.close(); toast('Rezept gespeichert');
  } },
  h('h2.sheet-title', null, r ? 'Rezept bearbeiten' : 'Neues Rezept'),
  h('div.row2', null, field('Name', f.title = h('input', { value: v.title, required: true, autofocus: !r, placeholder: 'z. B. Spaghetti Bolognese' })), field('Personen', f.servings = h('input', { type: 'number', min: 1, max: 30, value: v.servings || '', inputmode: 'numeric' }))),
  field('Symbol', ems),
  field('Zutaten – eine pro Zeile', f.ing = h('textarea', { rows: 6, value: v.ingredients, placeholder: '500 g Hackfleisch\n1 Zwiebel\n1 Dose Tomaten\n400 g Spaghetti' })),
  field('Zubereitung (optional)', f.steps = h('textarea', { rows: 4, value: v.steps })),
  h('div.row2', null, field('Link (optional)', f.url = h('input', { value: v.url, inputmode: 'url' })), field('Stichworte', f.tags = h('input', { value: v.tags, placeholder: 'schnell, vegetarisch' }))),
  h('div.btn-row', null,
    r ? h('button.btn.danger-ghost', { type: 'button', onclick: async () => { if (await confirmSheet({ title: `„${r.title}“ löschen?`, ok: 'Löschen', danger: true })) { store.del('recipes', r.id); s.close(); } } }, icon('trash', 18), 'Löschen') : h('span'),
    h('button.btn.primary', { type: 'submit' }, 'Speichern'))), { tall: true, label: 'Rezept' });
}

/** Kurzinfo für „Heute“ */
export function todayMealsCard() {
  const list = mealsOn(today());
  if (!list.length) return null;
  return h('section.section', null, h('h3.section-title', null, 'Essen heute'),
    h('a.card.meals-today', { href: '#essen' }, ...list.map((m) => h('div.mt-row', null, h('span.mt-emoji', null, m.emoji || SLOTS[m.slot]?.[1] || '🍽️'), h('small', null, SLOTS[m.slot]?.[0]), h('b', null, m.title)))));
}
