// Essensplan, Rezepte (mit Import von Chefkoch, Cookidoo & Co.) und Ernährungscoach.
//   meals   { date, slot: 'breakfast'|'lunch'|'dinner', title, recipeId, emoji }
//   recipes { title, emoji, image, servings, ingredients: "eine Zutat pro Zeile", steps, url, source, thermomix,
//             nutrition: {kcal, protein, fat, carbs, fiber, sugar} (pro Portion), totalMin, tags, cookedAt }
import { h, icon, toast, sheet, confirmSheet, promptSheet, fmt } from './ui.js';
import { store } from './store.js';
import { today, childMode } from './domain.js';
import { ymd, addDays, shoppingCategory } from './nlp.js';
import { haptic, openUrl, http, isApp } from './native.js';
import { parseRecipeHtml, searchLinks, scaleLine, sourceOf } from './recipeimport.js';
import { classify, badges, analyzeWeek, suggest, GOALS, nextWant } from './coach.js';

export const SLOTS = { breakfast: ['Frühstück', '🥐'], lunch: ['Mittag', '🍝'], dinner: ['Abend', '🍲'] };
const FOOD_EMOJI = ['🍝', '🍕', '🥗', '🍲', '🍛', '🌮', '🍔', '🥘', '🍜', '🐟', '🍗', '🥞', '🥪', '🍳', '🥦', '🍰'];
const field = (label, input) => h('label.field', null, h('span', null, label), input);

function weekStart(d) { const x = fmt.parse(d); const off = (x.getDay() + 6) % 7; return ymd(addDays(x, -off)); }
export function mealsOn(date) { return store.list('meals').filter((m) => m.date === date).sort((a, b) => Object.keys(SLOTS).indexOf(a.slot) - Object.keys(SLOTS).indexOf(b.slot)); }
function mealAt(date, slot) { return store.list('meals').find((m) => m.date === date && m.slot === slot); }
export function recipe(id) { return store.get('recipes', id); }

export function ingredientLines(r) {
  return String(r?.ingredients || '').split('\n').map((s) => s.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
}
/** "500 g Hackfleisch" → "Hackfleisch" (für Duplikat-Erkennung) */
function coreName(s) { return s.toLowerCase().replace(/^[\d.,/½¼¾\s-]+(g|kg|ml|l|el|tl|stk\.?|stück|prise|pck\.?|packung|dose[n]?|bund|becher|zehe[n]?|scheibe[n]?|glas|msp\.?|n\. b\.)?\.?\s+/i, '').replace(/\(.*?\)|,.*$/g, '').trim(); }

export function addIngredientsToShopping(recipes) {
  const open = store.list('shopping').filter((s) => !s.done).map((s) => coreName(s.name));
  const fresh = [];
  for (const r of recipes) for (const line of ingredientLines(r)) {
    const core = coreName(line);
    if (!core || /^(salz|pfeffer|wasser|öl|salz und pfeffer)$/i.test(core) || open.includes(core) || fresh.some((f) => coreName(f.name) === core)) continue;
    fresh.push({ name: line, category: shoppingCategory(core), done: false, note: r.title });
  }
  if (fresh.length) store.putMany('shopping', fresh);
  return fresh.length;
}

const thumb = (r, cls = 'thumb') => (r?.image ? h('span.' + cls, { style: { backgroundImage: `url("${r.image}")` }, role: 'img', 'aria-label': r.title }) : h('span.' + cls + '.emoji-thumb', null, r?.emoji || '🍽️'));
function mealInfo(m) { const r = m.recipeId ? recipe(m.recipeId) : null; return { ...m, recipe: r }; }

// ================= Essensplan =================
const state = { week: null };
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

  // Coach-Kurzfassung
  const weekMeals = store.list('meals').filter((m) => m.date >= days[0] && m.date <= days[6]).map(mealInfo);
  const a = analyzeWeek(weekMeals, days, store.config.nutritionGoal);
  if (!childMode() && a.score != null) {
    const top = a.tips[0];
    page.append(h('a.card.coach-mini', { href: '#coach' },
      scoreRing(a.score),
      h('div', null, h('b', null, 'Wochen-Balance'), h('small', null, top ? top.icon + ' ' + top.text : '')),
      icon('right', 18)));
  }

  const grid = h('div.meal-week');
  for (const d of days) {
    const dt = fmt.parse(d);
    grid.append(h('div.meal-day' + (d === today() ? '.today' : ''), null,
      h('div.md-head', null, h('b', null, fmt.WD[dt.getDay()]), h('span', null, dt.getDate() + '.')),
      ...slots.map((slot) => {
        const m = mealAt(d, slot);
        const r = m?.recipeId ? recipe(m.recipeId) : null;
        const c = m ? classify({ title: m.title, ingredients: r?.ingredients }) : null;
        return h('button.meal-slot' + (m ? '.set' : ''), { onclick: () => (childMode() ? (r && showRecipe(r)) : editMeal(d, slot, m)) },
          r?.image ? thumb(r, 'ms-thumb') : null,
          h('span.ms-text', null,
            h('small', null, SLOTS[slot][0], c ? ' ' + badges(c).slice(0, 2).map((b) => b[0]).join('') : ''),
            m ? h('span.ms-title', null, (r?.image ? '' : (m.emoji || r?.emoji || SLOTS[slot][1]) + ' ') + m.title) : h('span.ms-empty', null, childMode() ? '–' : '+')));
      })));
  }
  page.append(grid);
  if (!childMode()) {
    const weekRecipes = weekMeals.map((m) => m.recipe).filter(Boolean);
    page.append(h('div.btn-col', null,
      h('button.btn.tonal', { disabled: !weekRecipes.length, onclick: () => { const n = addIngredientsToShopping(weekRecipes); toast(n ? `${n} Zutaten auf die Einkaufsliste gesetzt` : 'Alles schon auf der Liste'); } }, icon('cart', 18), 'Zutaten der Woche auf die Einkaufsliste'),
      a.stats.openDays.length ? h('button.btn.ghost', { onclick: () => autoFill(days, slots) }, icon('sparkle', 18), `Offene Tage mit Ideen füllen (${a.stats.openDays.length})`) : null,
      h('div.chips', null, h('span.muted', null, 'Mahlzeiten:'), ...Object.entries(SLOTS).map(([k, [l, e]]) => h('button.chip' + (slots.includes(k) ? '.removable' : ''), { onclick: () => {
        const next = slots.includes(k) ? slots.filter((x) => x !== k) : [...slots, k].sort((x, y) => Object.keys(SLOTS).indexOf(x) - Object.keys(SLOTS).indexOf(y));
        if (next.length) store.saveConfig({ mealSlots: next });
      } }, e + ' ' + l)))));
  }
  return page;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}

function recentTitles(days = 21) {
  const from = ymd(addDays(new Date(), -days));
  return store.list('meals').filter((m) => m.date >= from).map((m) => m.title);
}

/** Lücken der Woche mit passenden Vorschlägen füllen (eigene Rezepte zuerst, dann Ideen-Pool). */
async function autoFill(days, slots) {
  const slot = slots.includes('dinner') ? 'dinner' : slots[slots.length - 1];
  const open = days.filter((d) => d >= today() && !mealAt(d, slot));
  if (!open.length) return toast('Keine offenen Tage ab heute');
  const planned = [];
  for (const d of open) {
    const weekMeals = [...store.list('meals').filter((m) => m.date >= days[0] && m.date <= days[6]).map(mealInfo), ...planned];
    const want = nextWant(analyzeWeek(weekMeals, days, store.config.nutritionGoal));
    const recent = [...recentTitles(), ...planned.map((p) => p.title)];
    const own = store.list('recipes').filter((r) => !recent.map((x) => x.toLowerCase()).includes(r.title.toLowerCase()))
      .filter((r) => { const c = classify(r); return !want || (want === 'fish' ? c.fish : want === 'vegetarian' ? c.vegetarian : want === 'legumes' ? c.legumes : true); });
    const pick = own.length ? { title: own[0].title, recipeId: own[0].id, emoji: own[0].emoji } : (() => { const i = suggest({ want, recent, limit: 1, seed: planned.length + Date.now() % 97 })[0] || suggest({ recent, limit: 1 })[0]; return i && { title: i.title, recipeId: null, emoji: i.emoji }; })();
    if (pick) planned.push({ date: d, slot, ...pick });
  }
  const ok = await confirmSheet({ title: 'Vorschlag für die Woche', text: planned.map((p) => `${fmt.dayLabel(p.date)}: ${p.emoji || ''} ${p.title}`).join('\n'), ok: 'Übernehmen' });
  if (!ok) return;
  for (const p of planned) store.put('meals', p);
  toast(`${planned.length} Gerichte eingeplant`);
}

export function editMeal(date, slot, m) {
  let input;
  const recipes = store.list('recipes').sort((a, b) => a.title.localeCompare(b.title));
  const recent = [...new Map(store.list('meals').filter((x) => !x.recipeId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((x) => [x.title.toLowerCase(), x])).values()].slice(0, 8);
  const days = [...Array(7)].map((_, i) => ymd(addDays(fmt.parse(weekStart(date)), i)));
  const weekMeals = store.list('meals').filter((x) => x.date >= days[0] && x.date <= days[6] && x.id !== m?.id).map(mealInfo);
  const want = nextWant(analyzeWeek(weekMeals, days, store.config.nutritionGoal));
  const ideas = suggest({ want, recent: recentTitles(), limit: 6, seed: fmt.parse(date).getDate() });
  const save = (s, data) => { store.put('meals', { ...(m || {}), date, slot, ...data }); haptic('success'); s.close(); };
  sheet((s) => h('div.sheet-body', null,
    h('h2.sheet-title', null, `${SLOTS[slot][1]} ${SLOTS[slot][0]} · ${fmt.dayLabel(date)}`),
    h('form.addbar', { onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (t) save(s, { title: t, recipeId: null, emoji: null }); } },
      input = h('input', { value: m && !m.recipeId ? m.title : '', placeholder: 'Was gibt es? z. B. Pfannkuchen', autofocus: true }),
      h('button.icon-btn.primary', { type: 'submit', 'aria-label': 'Speichern' }, icon('check'))),
    recipes.length ? h('h3.section-title', null, 'Aus euren Rezepten') : null,
    recipes.length ? h('div.pick-grid', null, ...recipes.map((r) => h('button.pick' + (m?.recipeId === r.id ? '.on' : ''), { onclick: () => save(s, { title: r.title, recipeId: r.id, emoji: r.emoji }) }, r.image ? thumb(r, 'pick-thumb') : h('span', null, r.emoji || '🍽️'), r.title))) : null,
    h('h3.section-title', null, want ? `Ideen · ${{ fish: 'mal wieder Fisch', vegetarian: 'vegetarisch', legumes: 'mit Hülsenfrüchten', light: 'etwas Leichtes' }[want]}` : 'Ideen'),
    h('div.pick-grid', null, ...ideas.map((i) => h('button.pick', { onclick: () => save(s, { title: i.title, recipeId: null, emoji: i.emoji }) }, h('span', null, i.emoji), i.title))),
    recent.length ? h('h3.section-title', null, 'Zuletzt') : null,
    recent.length ? h('div.chips', null, ...recent.map((x) => h('button.chip', { onclick: () => save(s, { title: x.title, recipeId: null, emoji: x.emoji }) }, x.title))) : null,
    h('div.btn-row', null,
      m ? h('button.btn.danger-ghost', { onclick: () => { store.del('meals', m.id); s.close(); } }, icon('trash', 18), 'Leeren') : h('span'),
      h('button.btn.ghost', { onclick: () => { s.close(); addRecipeMenu(); } }, icon('plus', 18), 'Rezept hinzufügen'))), { tall: true, label: 'Mahlzeit' });
}

// ================= Rezepte =================
const rstate = { q: '', filter: 'all' };
export function viewRecipes() {
  const page = h('div.subpage');
  const all = store.list('recipes').sort((a, b) => (b.cookedAt || 0) - (a.cookedAt || 0) || a.title.localeCompare(b.title));
  const q = rstate.q.toLowerCase();
  const filters = { all: ['Alle', () => true], veg: ['🥕 Vegetarisch', (r) => classify(r).vegetarian], fish: ['🐟 Fisch', (r) => classify(r).fish], quick: ['⚡ ≤ 30 Min.', (r) => r.totalMin && r.totalMin <= 30], tm: ['🔄 Thermomix', (r) => r.thermomix] };
  const list = all.filter((r) => (!q || (r.title + ' ' + (r.tags || '') + ' ' + (r.ingredients || '')).toLowerCase().includes(q)) && filters[rstate.filter][1](r));
  page.append(h('div.addbar', null,
    h('input', { value: rstate.q, placeholder: 'Rezept oder Zutat suchen', type: 'search', oninput: (e) => { rstate.q = e.target.value; const n = viewRecipes(); page.replaceWith(n); const i = n.querySelector('input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }),
    childMode() ? null : h('button.icon-btn.primary', { 'aria-label': 'Rezept hinzufügen', onclick: addRecipeMenu }, icon('plus'))));
  if (all.length > 3) page.append(h('div.filter.tight', null, ...Object.entries(filters).map(([k, [l]]) => h('button.fchip' + (rstate.filter === k ? '.on' : ''), { onclick: () => { rstate.filter = k; page.replaceWith(viewRecipes()); } }, l))));
  if (!all.length) page.append(h('div.card.tip', null, h('b', null, 'Rezeptsammlung'),
    h('p', null, 'Rezepte von Chefkoch, Cookidoo (Thermomix), EatSmarter, Lecker & Co. übernimmst du ganz einfach: Im Browser oder in der App auf „Teilen“ → FamilyHub tippen – oder den Link hier einfügen. Zutaten, Schritte, Foto und Nährwerte kommen automatisch mit.'),
    childMode() ? null : h('div.btn-col', null, h('button.btn.primary', { onclick: () => importDialog() }, icon('link', 18), 'Rezept per Link importieren'), h('button.btn.tonal', { onclick: () => ideaSearch() }, icon('sparkle', 18), 'Ideen suchen'))));
  page.append(h('div.recipe-grid', null, ...list.map((r) => h('button.recipe-card' + (r.image ? '.has-img' : ''), { onclick: () => showRecipe(r) },
    thumb(r, 'rc-img'),
    h('span.rc-body', null,
      h('b', null, r.title),
      h('small', null, [r.totalMin ? `⏱ ${r.totalMin} Min.` : null, r.nutrition?.kcal ? `🔥 ${Math.round(r.nutrition.kcal)} kcal` : null, r.thermomix ? '🔄 TM' : null].filter(Boolean).join(' · ') || `${ingredientLines(r).length} Zutaten`))))));
  return page;
}

export function addRecipeMenu() {
  sheet((s) => h('div.sheet-body', null,
    h('h2.sheet-title', null, 'Rezept hinzufügen'),
    h('div.menu', null,
      h('button.menu-row', { onclick: () => { s.close(); importDialog(); } }, h('span.mi', null, icon('link', 20)), h('span.mt', null, h('b', null, 'Per Link importieren'), h('small', null, 'Chefkoch, Cookidoo, EatSmarter, Lecker, Kitchen Stories …')), icon('right', 18)),
      h('button.menu-row', { onclick: () => { s.close(); ideaSearch(); } }, h('span.mi', null, icon('sparkle', 20)), h('span.mt', null, h('b', null, 'Ideen suchen'), h('small', null, 'In den großen Rezeptportalen stöbern')), icon('right', 18)),
      h('button.menu-row', { onclick: () => { s.close(); editRecipe(null); } }, h('span.mi', null, icon('edit', 20)), h('span.mt', null, h('b', null, 'Selbst eintippen'), h('small', null, 'Omas Klassiker & Familienrezepte')), icon('right', 18))),
    h('p.hint', null, 'Tipp: In der Chefkoch- oder Cookidoo-App bzw. im Browser auf „Teilen“ tippen und FamilyHub wählen – dann geht es ohne Kopieren.')), { label: 'Rezept hinzufügen' });
}

function ideaSearch(prefill = '') {
  const draw = (q) => h('div.menu', null, ...searchLinks(q || 'Familienessen').map(([name, ic, url]) => h('button.menu-row', { onclick: () => openUrl(url) }, h('span.mi.emoji-mi', null, ic), h('span.mt', null, h('b', null, name), h('small', null, q ? `„${q}“ suchen` : 'Beliebte Rezepte')), icon('external', 18))));
  let list; let input;
  sheet(() => h('div.sheet-body', null,
    h('h2.sheet-title', null, 'Ideen suchen'),
    h('div.addbar', null, input = h('input', { value: prefill, placeholder: 'z. B. Kürbissuppe, schnell, vegetarisch', oninput: () => { const n = draw(input.value.trim()); list.replaceWith(n); list = n; } })),
    list = draw(prefill),
    h('p.hint', null, 'Gefunden? In der Seite auf „Teilen“ → FamilyHub tippen, oder den Link kopieren und hier über „Per Link importieren“ einfügen.')), { tall: true, label: 'Ideen suchen' });
}

/** Rezeptseite laden: in der App direkt (eigene Internetverbindung des Handys), im Browser über den Pi. */
async function fetchPage(url) {
  if (isApp) {
    const r = await http(url, { timeout: 20000, headers: { Accept: 'text/html', 'Accept-Language': 'de-DE,de;q=0.9' } });
    if (r.status >= 400) throw new Error('Seite antwortet mit HTTP ' + r.status);
    return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  }
  if (store.serverEnabled()) return (await store.request('api/v2/fetch', { method: 'POST', body: { url }, timeout: 25000 })).text;
  throw new Error('Im Browser klappt der Import nur mit verbundenem Pi – in der App immer.');
}

export async function importDialog(prefill = '') {
  if (!prefill && navigator.clipboard?.readText) { try { const c = await navigator.clipboard.readText(); if (/^https?:\/\//.test(c.trim())) prefill = c.trim(); } catch { /* keine Berechtigung */ } }
  const url = await promptSheet({ title: 'Rezept importieren', label: 'Link zum Rezept', value: prefill, type: 'text', ok: 'Importieren', placeholder: 'https://www.chefkoch.de/rezepte/…', hint: 'Funktioniert mit Chefkoch, Cookidoo (öffentliche Rezeptseiten), EatSmarter, Lecker, Kitchen Stories, Essen & Trinken und den meisten Rezeptseiten.' });
  if (url) importRecipe(url);
}

export async function importRecipe(rawUrl) {
  const url = (String(rawUrl).match(/https?:\/\/\S+/) || [])[0]?.replace(/[)>\].,]+$/, '');
  if (!url) return toast('Kein Link gefunden');
  const existing = store.list('recipes').find((r) => r.url === url);
  if (existing) { toast('Schon in euren Rezepten'); return showRecipe(existing); }
  toast(`${sourceOf(url).icon} Rezept wird geladen …`);
  try {
    const r = parseRecipeHtml(await fetchPage(url), url);
    if (!r) throw new Error('Auf der Seite wurde kein Rezept gefunden');
    if (/cookidoo/i.test(url) && !r.ingredients.length) r.note = 'Cookidoo zeigt Zutaten oft nur angemeldet – bitte ggf. ergänzen.';
    previewImport(r);
  } catch (e) { toast(e.message || 'Import fehlgeschlagen'); }
}

function previewImport(r) {
  const c = classify({ title: r.title, ingredients: r.ingredients, tags: r.tags.join(',') });
  sheet((s) => h('div.sheet-body', null,
    r.image ? h('div.import-img', { style: { backgroundImage: `url("${r.image}")` } }) : null,
    h('h2.sheet-title', null, r.title),
    h('p.muted', null, `${sourceOf(r.url).icon} ${r.source}${r.servings ? ' · ' + r.servings + ' Portionen' : ''}${r.totalMin ? ' · ' + r.totalMin + ' Min.' : ''}`),
    h('div.chips', null, ...badges(c).map(([e, l]) => h('span.pill', null, e + ' ' + l))),
    r.nutrition ? nutritionTable(r.nutrition) : null,
    r.note || r.partial ? h('p.hint', null, r.note || 'Die Seite enthält keine Rezeptdaten – Titel und Bild wurden übernommen, Zutaten bitte ergänzen.') : null,
    r.ingredients.length ? h('p.muted', null, `${r.ingredients.length} Zutaten · ${r.steps.length} Schritte`) : null,
    h('div.btn-col', null,
      h('button.btn.primary', { onclick: () => {
        const saved = store.put('recipes', {
          title: r.title, emoji: c.fish ? '🐟' : c.meat ? '🍖' : '🥗', image: r.image, servings: r.servings, ingredients: r.ingredients.join('\n'), steps: r.steps.join('\n'),
          url: r.url, source: r.source, thermomix: r.thermomix, nutrition: r.nutrition, totalMin: r.totalMin, tags: r.tags.join(', '),
        });
        s.close(); toast('Rezept gespeichert 🎉'); location.hash = 'rezepte';
        if (r.partial || !r.ingredients.length) editRecipe(saved);
      } }, icon('check', 18), 'In Rezepte übernehmen'),
      h('button.btn.ghost', { onclick: () => s.close() }, 'Abbrechen'))), { tall: true, label: 'Import' });
}

function nutritionTable(n, factor = 1) {
  const cell = (v, unit, label) => (v != null ? h('div.nt', null, h('b', null, `${Math.round(v * factor)}${unit}`), h('small', null, label)) : null);
  return h('div.nutrition', null, cell(n.kcal, '', 'kcal'), cell(n.protein, ' g', 'Eiweiß'), cell(n.carbs, ' g', 'Kohlenh.'), cell(n.fat, ' g', 'Fett'), cell(n.fiber, ' g', 'Ballastst.'));
}

function showRecipe(r) {
  const lines = ingredientLines(r);
  let servings = r.servings || 4;
  const c = classify(r);
  const ingList = h('ul.ingredients');
  const servLabel = h('b');
  const drawIng = () => { const f = r.servings ? servings / r.servings : 1; ingList.replaceChildren(...lines.map((l) => h('li', null, scaleLine(l, f)))); servLabel.textContent = `${servings} Portionen`; };
  drawIng();
  const steps = String(r.steps || '').split('\n').filter(Boolean);
  const src = r.url ? sourceOf(r.url) : null;
  sheet((s) => h('div.sheet-body', null,
    r.image ? h('div.import-img', { style: { backgroundImage: `url("${r.image}")` } }) : h('div.recipe-hero', null, h('span', null, r.emoji || '🍽️')),
    h('h2.sheet-title', null, r.title),
    h('div.chips', null,
      src ? h('span.pill', null, `${src.icon} ${r.source || src.name}`) : null,
      r.totalMin ? h('span.pill', null, `⏱ ${r.totalMin} Min.`) : null,
      ...badges(c).map(([e, l]) => h('span.pill', null, e + ' ' + l))),
    r.nutrition ? h('section.section', null, h('h3.section-title', null, 'Nährwerte pro Portion'), nutritionTable(r.nutrition)) : null,
    lines.length ? h('section.section', null,
      h('div.serv-row', null, h('h3.section-title', null, 'Zutaten'), h('span.spacer'),
        h('button.icon-btn', { 'aria-label': 'Weniger Portionen', onclick: () => { if (servings > 1) { servings--; drawIng(); } } }, '−'), servLabel,
        h('button.icon-btn', { 'aria-label': 'Mehr Portionen', onclick: () => { servings++; drawIng(); } }, icon('plus', 18))),
      ingList) : null,
    steps.length ? h('section.section', null, h('h3.section-title', null, 'Zubereitung'), h('ol.steps-ol', null, ...steps.map((st) => (st.startsWith('—') ? h('li.sec', null, st.replace(/—/g, '').trim()) : h('li', null, st))))) : null,
    r.url ? h('button.btn.tonal', { onclick: () => openUrl(r.url) }, icon('external', 18), r.thermomix ? 'In Cookidoo / Thermomix öffnen' : `Bei ${r.source || 'der Quelle'} öffnen`) : null,
    childMode() ? null : h('div.btn-col', null,
      h('button.btn.primary', { onclick: () => { s.close(); planRecipe(r); } }, icon('calendar', 18), 'Im Essensplan einplanen'),
      h('button.btn.tonal', { onclick: () => { const n = addIngredientsToShopping([r]); toast(n ? `${n} Zutaten auf die Liste` : 'Alles schon auf der Liste'); } }, icon('cart', 18), 'Zutaten auf die Einkaufsliste'),
      h('button.btn.ghost', { onclick: () => { store.put('recipes', { ...r, cookedAt: Date.now() }); toast('Als gekocht markiert 👩‍🍳'); } }, '👩‍🍳 Heute gekocht'),
      h('button.btn.ghost', { onclick: () => { s.close(); editRecipe(r); } }, icon('edit', 18), 'Bearbeiten'))), { tall: true, label: r.title });
}

function planRecipe(r) {
  const days = [...Array(10)].map((_, i) => ymd(addDays(new Date(), i)));
  let slot = (store.config.mealSlots || ['lunch', 'dinner']).slice(-1)[0];
  sheet((s) => {
    const slotRow = h('div.seg', null, ...Object.entries(SLOTS).map(([k, [l]]) => h('button.seg-btn' + (k === slot ? '.on' : ''), { onclick: (e) => { slot = k; [...e.currentTarget.parentNode.children].forEach((x) => x.classList.toggle('on', x === e.currentTarget)); } }, l)));
    return h('div.sheet-body', null, h('h2.sheet-title', null, `${r.title} einplanen`), slotRow,
      h('div.pick-grid', null, ...days.map((d) => {
        const ex = mealAt(d, slot);
        return h('button.pick', { onclick: () => { store.put('meals', { ...(mealAt(d, slot) || {}), date: d, slot, title: r.title, recipeId: r.id, emoji: r.emoji }); s.close(); toast(`${r.title}: ${fmt.dayLabel(d)}, ${SLOTS[slot][0]}`); } }, h('span.pick-day', null, fmt.dayLabel(d), ex ? h('small', null, ex.title) : null));
      })));
  }, { label: 'Einplanen' });
}

export function editRecipe(r) {
  const v = { title: '', emoji: '🍝', servings: 4, ingredients: '', steps: '', url: '', tags: '', nutrition: {}, ...(r || {}) };
  const n = v.nutrition || {};
  const f = {};
  let emoji = v.emoji;
  const ems = h('div.emojis');
  const drawE = () => ems.replaceChildren(...FOOD_EMOJI.map((e) => h('button.emoji' + (e === emoji ? '.on' : ''), { type: 'button', onclick: () => { emoji = e; drawE(); } }, e)));
  drawE();
  const numIn = (val) => h('input', { type: 'number', min: 0, step: 'any', value: val ?? '', inputmode: 'decimal' });
  sheet((s) => h('form.sheet-body', { onsubmit: (e) => {
    e.preventDefault();
    const title = f.title.value.trim(); if (!title) return;
    const nv = (x) => (x.value === '' ? null : +x.value);
    const nutrition = { kcal: nv(f.kcal), protein: nv(f.protein), carbs: nv(f.carbs), fat: nv(f.fat) };
    store.put('recipes', { ...(r || {}), title, emoji, servings: +f.servings.value || null, ingredients: f.ing.value.trim(), steps: f.steps.value.trim(), url: f.url.value.trim(), tags: f.tags.value.trim(), totalMin: +f.time.value || null, nutrition: Object.values(nutrition).some((x) => x != null) ? { ...n, ...nutrition } : null });
    s.close(); toast('Rezept gespeichert');
  } },
  h('h2.sheet-title', null, r ? 'Rezept bearbeiten' : 'Neues Rezept'),
  h('div.row2', null, field('Name', f.title = h('input', { value: v.title, required: true, autofocus: !r, placeholder: 'z. B. Spaghetti Bolognese' })), field('Personen', f.servings = h('input', { type: 'number', min: 1, max: 30, value: v.servings || '', inputmode: 'numeric' }))),
  v.image ? null : field('Symbol', ems),
  field('Zutaten – eine pro Zeile', f.ing = h('textarea', { rows: 6, value: v.ingredients, placeholder: '500 g Hackfleisch\n1 Zwiebel\n1 Dose Tomaten\n400 g Spaghetti' })),
  field('Zubereitung – ein Schritt pro Zeile', f.steps = h('textarea', { rows: 4, value: v.steps })),
  h('div.row2', null, field('Dauer (Min.)', f.time = numIn(v.totalMin)), field('kcal pro Portion', f.kcal = numIn(n.kcal))),
  h('div.row3', null, field('Eiweiß g', f.protein = numIn(n.protein)), field('Kohlenh. g', f.carbs = numIn(n.carbs)), field('Fett g', f.fat = numIn(n.fat))),
  h('div.row2', null, field('Link (optional)', f.url = h('input', { value: v.url, inputmode: 'url' })), field('Stichworte', f.tags = h('input', { value: v.tags, placeholder: 'schnell, vegetarisch' }))),
  h('div.btn-row', null,
    r ? h('button.btn.danger-ghost', { type: 'button', onclick: async () => { if (await confirmSheet({ title: `„${r.title}“ löschen?`, ok: 'Löschen', danger: true })) { store.del('recipes', r.id); s.close(); } } }, icon('trash', 18), 'Löschen') : h('span'),
    h('button.btn.primary', { type: 'submit' }, 'Speichern'))), { tall: true, label: 'Rezept' });
}

// ================= Ernährungscoach =================
function scoreRing(score) {
  const color = score >= 80 ? 'var(--ok)' : score >= 55 ? '#E0A100' : 'var(--accent)';
  return h('span.score', { style: { '--p': score / 100, '--sc': color } }, h('span', null, score));
}

const cstate = { week: null, seed: 1 };
export function viewCoach() {
  if (!cstate.week) cstate.week = weekStart(today());
  const page = h('div.subpage');
  const rerender = () => page.replaceWith(viewCoach());
  const days = [...Array(7)].map((_, i) => ymd(addDays(fmt.parse(cstate.week), i)));
  const meals = store.list('meals').filter((m) => m.date >= days[0] && m.date <= days[6]).map(mealInfo);
  const goalKey = store.config.nutritionGoal || 'balanced';
  const a = analyzeWeek(meals, days, goalKey);
  const s = a.stats;
  page.append(h('div.date-switch', null,
    h('button.icon-btn', { 'aria-label': 'Vorige Woche', onclick: () => { cstate.week = ymd(addDays(fmt.parse(cstate.week), -7)); rerender(); } }, icon('left')),
    h('b', null, cstate.week === weekStart(today()) ? 'Diese Woche' : `KW ${isoWeek(fmt.parse(cstate.week))}`),
    h('button.icon-btn', { 'aria-label': 'Nächste Woche', onclick: () => { cstate.week = ymd(addDays(fmt.parse(cstate.week), 7)); rerender(); } }, icon('right'))));

  page.append(h('div.card.coach-head', null,
    a.score != null ? scoreRing(a.score) : h('span.score.empty', null, h('span', null, '–')),
    h('div', null,
      h('b', null, a.score == null ? 'Noch nichts geplant' : a.score >= 80 ? 'Sehr ausgewogen' : a.score >= 55 ? 'Auf gutem Weg' : 'Da geht noch was'),
      h('small', null, `Ziel: ${GOALS[goalKey].label}`),
      h('select.mini', { 'aria-label': 'Ernährungsziel', onchange: (e) => store.saveConfig({ nutritionGoal: e.target.value }) }, ...Object.entries(GOALS).map(([k, g]) => h('option', { value: k, selected: k === goalKey }, g.label))))));

  page.append(h('div.coach-stats', null,
    stat('🥩', s.meat, 'Fleisch', s.meat > a.goal.meatMax), stat('🐟', s.fish, 'Fisch', s.planned >= 3 && s.fish < a.goal.fishMin),
    stat('🥕', s.vegetarian, 'Vegetarisch'), stat('🥦', `${s.veggies}/${s.planned}`, 'mit Gemüse'),
    s.kcalAvg ? stat('🔥', s.kcalAvg, `kcal Ø (${s.kcalKnown})`) : stat('🫘', s.legumes, 'Hülsenfr.')));

  page.append(h('h3.section-title', null, 'Tipps vom Coach'), h('div.tips-list', null, ...a.tips.map((t) => h('div.ctip.' + t.level, null,
    h('span.tip-ic', null, t.icon), h('span.tip-text', null, t.text),
    t.want ? h('button.btn.small.tonal', { onclick: () => { document.getElementById('ideas')?.scrollIntoView({ behavior: 'smooth' }); cstate.want = t.want; page.replaceWith(viewCoach()); } }, 'Ideen') : null))));

  const want = cstate.want || nextWant(a);
  const ideas = suggest({ want, recent: recentTitles(), limit: 8, seed: cstate.seed });
  const ownFit = store.list('recipes').filter((r) => { const c = classify(r); return want === 'fish' ? c.fish : want === 'vegetarian' ? c.vegetarian : want === 'legumes' ? c.legumes : want === 'light' ? (r.nutrition?.kcal || 999) < 600 : true; }).slice(0, 6);
  page.append(h('div.serv-row', { id: 'ideas' }, h('h3.section-title', null, want ? `Ideen · ${{ fish: 'Fisch', vegetarian: 'vegetarisch', legumes: 'Hülsenfrüchte', light: 'leicht' }[want]}` : 'Ideen für euch'), h('span.spacer'),
    h('button.btn.small.ghost', { onclick: () => { cstate.seed++; rerender(); } }, icon('sync', 16), 'Andere')),
  ownFit.length ? h('div.pick-grid', null, ...ownFit.map((r) => h('button.pick', { onclick: () => showRecipe(r) }, r.image ? thumb(r, 'pick-thumb') : h('span', null, r.emoji || '🍽️'), r.title))) : null,
  h('div.idea-list', null, ...ideas.map((i) => h('div.idea', null,
    h('span.idea-emoji', null, i.emoji),
    h('span.idea-main', null, h('b', null, i.title), h('small', null, [i.quick ? '⚡ schnell' : null, i.kids ? '🧒 kinderbeliebt' : null, i.thermomix ? '🔄 Thermomix-tauglich' : null, i.fish ? '🐟' : i.meat ? '🥩' : '🥕'].filter(Boolean).join(' · '))),
    h('button.icon-btn', { 'aria-label': 'Rezept suchen', title: 'Rezept suchen', onclick: () => ideaSearch(i.title) }, icon('external', 18)),
    childMode() ? null : h('button.icon-btn.primary', { 'aria-label': 'Einplanen', onclick: () => planIdea(i, days) }, icon('plus', 18))))),
  h('p.hint', null, 'Der Coach orientiert sich an den Empfehlungen der Deutschen Gesellschaft für Ernährung (DGE). Er ersetzt keine ärztliche oder diätologische Beratung.'));
  cstate.want = null;
  return page;
}
function stat(ic, val, label, warn) { return h('div.cstat' + (warn ? '.warn' : ''), null, h('span', null, ic), h('b', null, val), h('small', null, label)); }

function planIdea(i, days) {
  const slot = (store.config.mealSlots || ['lunch', 'dinner']).includes('dinner') ? 'dinner' : (store.config.mealSlots || ['lunch'])[0];
  const free = days.filter((d) => d >= today() && !mealAt(d, slot));
  sheet((s) => h('div.sheet-body', null, h('h2.sheet-title', null, `${i.emoji} ${i.title}`),
    h('p.muted', null, `Für ${SLOTS[slot][0].toLowerCase()} einplanen:`),
    h('div.pick-grid', null, ...(free.length ? free : days.filter((d) => d >= today())).map((d) => h('button.pick', { onclick: () => { store.put('meals', { ...(mealAt(d, slot) || {}), date: d, slot, title: i.title, emoji: i.emoji, recipeId: null }); s.close(); toast(`${i.title}: ${fmt.dayLabel(d)}`); } }, fmt.dayLabel(d))))), { label: 'Einplanen' });
}

/** Kurzinfo für „Heute“ */
export function todayMealsCard() {
  const list = mealsOn(today());
  if (!list.length) return null;
  return h('section.section', null, h('h3.section-title', null, 'Essen heute'),
    h('a.card.meals-today', { href: '#essen' }, ...list.map((m) => { const r = m.recipeId ? recipe(m.recipeId) : null; return h('div.mt-row', null, r?.image ? thumb(r, 'mt-thumb') : h('span.mt-emoji', null, m.emoji || SLOTS[m.slot]?.[1] || '🍽️'), h('small', null, SLOTS[m.slot]?.[0]), h('b', null, m.title)); })));
}
