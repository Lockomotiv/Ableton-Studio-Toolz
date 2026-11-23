// Einkauf: Liste je Laden, Auswahl per Bildkachel, wiederkehrende Einkäufe, Prospekte.
//   shopping { name, emoji, category, store, qty, unit, note, offer, done, doneAt }
//   catalog  { id: 'c_<name>', name, emoji, category, store, repeat, lastAdded, lastBought, count }  (eigene Artikel & Vorlieben)
import { h, icon, toast, sheet, confirmSheet, promptSheet } from './ui.js';
import { store as db } from './store.js';
import { childMode } from './domain.js';
import { haptic, openUrl } from './native.js';
import { CATALOG, CATEGORIES, CATEGORY_ORDER, STORES, store as storeOf, catEmoji, catStore, categoryOf, emojiOf, lookup, tidy, REPEATS, isDue } from './catalog.js';
import { listen, voiceAvailable } from './voice.js';
import { parse } from './nlp.js';
import { members } from './domain.js';
import { subnav, KITCHEN_TABS } from './views.js';

// Offizielle Prospekt-/Angebotsseiten (in den Einstellungen des Ladens änderbar)
export const LEAFLETS = {
  marktkauf: 'https://www.marktkauf.de/angebote',
  rewe: 'https://www.rewe.de/angebote/',
  edeka: 'https://www.edeka.de/eh/angebote.jsp',
  lidl: 'https://www.lidl.de/c/online-prospekte/s10005610',
  aldi: 'https://www.aldi-nord.de/prospekte.html',
  rossmann: 'https://www.rossmann.de/de/angebote',
};
const OFFER_SEARCH = (q) => `https://www.marktguru.de/search/${encodeURIComponent(q)}`;

const key = (name) => 'c_' + String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56);
const pref = (name) => db.get('catalog', key(name));
function remember(name, patch) {
  const id = key(name); const old = db.get('catalog', id);
  db.put('catalog', { ...(old || { name: tidy(name), emoji: emojiOf(name), category: categoryOf(name) }), ...patch, id });
}
export function defaultStore(name, category) { return pref(name)?.store ?? catStore(category || categoryOf(name)) ?? null; }

const st = { store: 'all' };

/** Artikel auf die Liste setzen (oder Menge erhöhen). Gibt den Eintrag zurück. */
export function addItem(name, { storeId, qty = 1, unit = '', note = '', offer = false, silent = false } = {}) {
  name = tidy(name); if (!name) return null;
  const p = pref(name); const known = lookup(name);
  const category = p?.category || known?.c || categoryOf(name);
  const emoji = p?.emoji || known?.e || catEmoji(category);
  const target = storeId !== undefined ? storeId : (p?.store ?? catStore(category) ?? null);
  const open = db.list('shopping').find((s) => !s.done && s.name.toLowerCase() === name.toLowerCase() && (s.store || null) === (target || null));
  let it;
  if (open) it = db.put('shopping', { ...open, qty: (+open.qty || 1) + qty, offer: open.offer || offer });
  else {
    const bought = db.list('shopping').find((s) => s.done && s.name.toLowerCase() === name.toLowerCase());
    it = db.put('shopping', { ...(bought || {}), name, emoji, category, store: target, qty, unit, note, offer, done: false, doneAt: null, addedBy: db.config.meId || null });
  }
  remember(name, { lastAdded: Date.now(), count: (p?.count || 0) + 1, ...(p ? {} : { emoji, category }) });
  if (!silent) haptic();
  return it;
}

// ================= Liste =================
export function viewShopping() {
  const page = h('div.page.shopping');
  const rerender = () => page.replaceWith(viewShopping());
  const all = db.list('shopping');
  const open = all.filter((s) => !s.done);
  const done = all.filter((s) => s.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const count = (sid) => open.filter((s) => (sid === 'none' ? !s.store : s.store === sid)).length;
  const kid = childMode();

  page.append(h('div.page-head', null, h('h1', null, 'Einkauf'), h('span.count', null, open.length ? `${open.length} offen` : '')), subnav(KITCHEN_TABS, 'einkauf'));

  // Läden
  page.append(h('div.store-tabs', { role: 'tablist' },
    h('button.store-tab' + (st.store === 'all' ? '.on' : ''), { onclick: () => { st.store = 'all'; rerender(); } }, h('span.st-logo.all', null, '🛒'), h('span', null, 'Alle'), open.length ? h('b', null, open.length) : null),
    ...STORES.map((s) => h('button.store-tab' + (st.store === s.id ? '.on' : ''), { style: { '--sc': s.color, '--si': s.ink || '#fff' }, onclick: () => { st.store = s.id; rerender(); } },
      h('span.st-logo', null, s.short), h('span', null, s.name), count(s.id) ? h('b', null, count(s.id)) : null))));

  // Hinzufügen
  if (!kid) page.append(h('div.add-row', null,
    h('button.btn.primary.big.add-main', { onclick: () => openPicker(st.store === 'all' ? undefined : st.store) }, icon('plus', 20), st.store === 'all' ? 'Artikel hinzufügen' : `Für ${storeOf(st.store).name} hinzufügen`),
    voiceAvailable() ? h('button.icon-btn.mic.big-mic', { 'aria-label': 'Per Sprache', onclick: () => voiceAdd(st.store === 'all' ? undefined : st.store) }, icon('mic')) : null));

  // Wiederkehrend fällig
  const due = db.list('catalog').filter((c) => isDue(c) && !open.some((s) => s.name.toLowerCase() === c.name.toLowerCase()));
  if (due.length && !kid) page.append(h('div.card.due-card', null,
    h('div.due-head', null, h('b', null, '🔁 Wiederkehrend fällig', h('span.count-pill', null, due.length)), h('button.btn.small.primary', { onclick: () => { due.forEach((c) => addItem(c.name, { silent: true })); haptic('success'); toast(`${due.length} Stammartikel hinzugefügt`); } }, 'Alle hinzufügen')),
    h('div.tile-row', null, ...due.map((c) => tile({ name: c.name, emoji: c.emoji, small: REPEATS[c.repeat]?.[0] }, () => { addItem(c.name); rerender(); })))));

  // Liste
  const visible = open.filter((s) => st.store === 'all' || s.store === st.store);
  const anywhere = st.store !== 'all' ? open.filter((s) => !s.store) : [];
  if (!visible.length && !anywhere.length) page.append(h('div.empty', null, h('div.empty-emoji', null, '🛒'), h('p', null, st.store === 'all' ? 'Die Einkaufsliste ist leer.' : `Für ${storeOf(st.store).name} steht nichts auf der Liste.`)));
  const group = (items, title) => {
    const byCat = {};
    for (const s of items) (byCat[s.category || categoryOf(s.name)] ||= []).push(s);
    const out = [];
    if (title) out.push(h('h3.section-title.store-sec', null, title));
    for (const cat of CATEGORY_ORDER) if (byCat[cat]) out.push(h('section.section.shop-cat', { style: { '--t': tint(cat) } }, h('h3.section-title', null, catEmoji(cat) + ' ' + cat), h('div.shop-list', null, ...byCat[cat].sort((a, b) => a.name.localeCompare(b.name)).map((s) => shopRow(s, rerender)))));
    return out;
  };
  page.append(...group(visible));
  if (anywhere.length) page.append(...group(anywhere, '📍 In jedem Laden erhältlich'));

  if (done.length) page.append(h('section.section', null, h('h3.section-title', null, 'Im Wagen', h('span.count-pill', null, done.length)), h('div.shop-list.done-list', null, ...done.slice(0, 40).map((s) => shopRow(s, rerender)))),
    kid ? null : h('button.btn.ghost.more-btn', { onclick: () => { done.forEach((s) => db.del('shopping', s.id)); toast('Liste aufgeräumt', { label: 'Rückgängig', run: () => db.putMany('shopping', done) }); } }, icon('trash', 18), 'Gekaufte entfernen'));

  // Prospekte
  page.append(h('section.section', null, h('h3.section-title', null, '📰 Aktuelle Prospekte'),
    h('div.leaflets', null, ...STORES.filter((s) => st.store === 'all' || s.id === st.store).map((s) => h('button.leaflet', { style: { '--sc': s.color, '--si': s.ink || '#fff' }, onclick: () => openUrl(leafletUrl(s.id)) }, h('span.st-logo', null, s.short), h('span', null, s.name), icon('external', 16)))),
    h('p.hint', null, 'Öffnet den offiziellen Prospekt des Ladens. Angebot entdeckt? Artikel hinzufügen und im Artikel „Angebot“ markieren.')));
  return page;
}
export function leafletUrl(id) { return db.config.leaflets?.[id] || LEAFLETS[id]; }

function storeBadge(id) { const s = storeOf(id); return s ? h('span.store-badge', { style: { '--sc': s.color, '--si': s.ink || '#fff' }, title: s.name }, s.short) : null; }

function shopRow(s, rerender) {
  let timer = null; let long = false;
  const el = h('div.shop-item' + (s.done ? '.done' : '') + (s.offer ? '.offer' : ''), { role: 'button', tabindex: 0, style: { '--t': tint(s.category || categoryOf(s.name)) } },
    h('span.si-emoji', null, s.emoji || emojiOf(s.name)),
    h('span.si-main', null, h('b', null, s.name), (s.note || s.unit || s.offer) ? h('small', null, [s.offer ? '🏷️ Angebot' : null, s.unit, s.note].filter(Boolean).join(' · ')) : null),
    (+s.qty || 1) > 1 ? h('span.qty', null, `${s.qty}×`) : null,
    storeBadge(s.store),
    h('button.icon-btn.si-more', { 'aria-label': 'Bearbeiten', onclick: (e) => { e.stopPropagation(); editItem(s); } }, icon('more', 18)));
  const toggle = () => {
    haptic(s.done ? 'tick' : 'success');
    db.put('shopping', { ...s, done: !s.done, doneAt: s.done ? null : Date.now() });
    if (!s.done) remember(s.name, { lastBought: Date.now() });
  };
  el.addEventListener('pointerdown', () => { long = false; timer = setTimeout(() => { long = true; haptic(); editItem(s); }, 500); });
  el.addEventListener('pointerup', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => clearTimeout(timer));
  el.addEventListener('click', () => { if (!long) toggle(); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}

// ================= Artikel bearbeiten =================
export function editItem(s) {
  const base = db.get('shopping', s.id) || s;
  let qty = +base.qty || 1; let storeId = base.store || null; let offer = !!base.offer;
  const p = pref(base.name); let repeat = p?.repeat || null;
  const f = {};
  const qtyEl = h('b.qty-val', null, qty);
  const stores = h('div.store-pick');
  const drawStores = () => stores.replaceChildren(
    h('button.sp' + (!storeId ? '.on' : ''), { type: 'button', onclick: () => { storeId = null; drawStores(); } }, 'Egal'),
    ...STORES.map((x) => h('button.sp' + (storeId === x.id ? '.on' : ''), { type: 'button', style: { '--sc': x.color, '--si': x.ink || '#fff' }, onclick: () => { storeId = x.id; drawStores(); } }, x.name)));
  drawStores();
  const reps = h('div.store-pick');
  const drawReps = () => reps.replaceChildren(h('button.sp' + (!repeat ? '.on' : ''), { type: 'button', onclick: () => { repeat = null; drawReps(); } }, 'Nie'),
    ...Object.entries(REPEATS).map(([k, [l]]) => h('button.sp' + (repeat === k ? '.on' : ''), { type: 'button', onclick: () => { repeat = k; drawReps(); } }, l)));
  drawReps();
  sheet((sh) => h('form.sheet-body', { onsubmit: (e) => {
    e.preventDefault();
    const name = tidy(f.name.value); if (!name) return;
    db.put('shopping', { ...base, name, qty, unit: f.unit.value.trim(), note: f.note.value.trim(), store: storeId, offer, category: f.cat.value, emoji: base.emoji || emojiOf(name) });
    remember(name, { store: storeId, repeat, category: f.cat.value, ...(repeat ? { lastAdded: Date.now() } : {}) });
    sh.close();
  } },
  h('div.item-hero', null, h('span', null, base.emoji || emojiOf(base.name)), f.name = h('input.pv-title', { value: base.name, 'aria-label': 'Artikel' })),
  h('label.field', null, h('span', null, 'Menge'), h('div.qty-row', null,
    h('button.icon-btn.qty-btn', { type: 'button', 'aria-label': 'Weniger', onclick: () => { if (qty > 1) { qty--; qtyEl.textContent = qty; } } }, '−'), qtyEl,
    h('button.icon-btn.qty-btn', { type: 'button', 'aria-label': 'Mehr', onclick: () => { qty++; qtyEl.textContent = qty; } }, '+'),
    f.unit = h('input.unit', { value: base.unit || '', placeholder: 'z. B. 1 kg, Packung, 6er' }))),
  h('label.field', null, h('span', null, 'Laden'), stores),
  h('label.field', null, h('span', null, 'Regelmäßig kaufen'), reps),
  h('label.switch', null, h('input', { type: 'checkbox', checked: offer, onchange: (e) => { offer = e.target.checked; } }), h('span.track'), h('span', null, '🏷️ Angebot (aus dem Prospekt)')),
  h('div.row2', null,
    h('label.field', null, h('span', null, 'Bereich'), f.cat = h('select', null, ...CATEGORY_ORDER.map((c) => h('option', { value: c, selected: (base.category || categoryOf(base.name)) === c }, catEmoji(c) + ' ' + c)))),
    h('label.field', null, h('span', null, 'Notiz'), f.note = h('input', { value: base.note || '', placeholder: 'z. B. Bio, laktosefrei' }))),
  h('button.btn.ghost', { type: 'button', onclick: () => openUrl(OFFER_SEARCH(base.name)) }, '🏷️ Aktuelle Angebote für „' + base.name + '“ suchen'),
  h('div.btn-row', null,
    h('button.btn.danger-ghost', { type: 'button', onclick: () => { db.del('shopping', base.id); sh.close(); toast('Entfernt', { label: 'Rückgängig', run: () => db.put('shopping', base) }); } }, icon('trash', 18), 'Entfernen'),
    h('button.btn.primary', { type: 'submit' }, 'Speichern'))), { tall: true, label: 'Artikel' });
}

// Ruhige Erkennungsfarbe je Bereich (Symbole im Erwachsenenprofil)
const TINT = { 'Obst & Gemüse': '#3F8F4E', 'Brot & Backwaren': '#A8742F', 'Milch, Käse & Eier': '#3F7FBF', 'Fleisch, Wurst & Fisch': '#BC4A45', 'Tiefkühl': '#2F93B5', 'Nudeln, Reis & Vorrat': '#B88A1E', 'Konserven & Soßen': '#B0533A', 'Frühstück & Aufstriche': '#C27F22', 'Backen & Gewürze': '#8A6A4E', 'Süßes & Snacks': '#B04C7C', 'Getränke': '#2A8AA0', 'Baby & Kind': '#8768C2', 'Hygiene & Pflege': '#7259C4', 'Reinigung & Waschen': '#23917F', 'Haushalt & Papier': '#64748B', 'Tierbedarf': '#94703F' };
export const tint = (cat) => TINT[cat] || '#64748B';

// ================= Bildkachel-Auswahl =================
function tile(it, onclick, badge) {
  return h('button.tile' + (badge ? '.on' : ''), { onclick, 'aria-label': it.name, style: { '--t': tint(it.cat || categoryOf(it.name)) } }, h('span.tile-emoji', null, it.emoji), h('span.tile-name', null, it.name), it.small ? h('small', null, it.small) : null, badge ? h('span.tile-badge', null, badge) : null);
}

export function openPicker(storeId) {
  let q = ''; let cat = null; let target = storeId; let added = 0;
  const onList = () => { const m = new Map(); for (const s of db.list('shopping')) if (!s.done) m.set(s.name.toLowerCase(), (m.get(s.name.toLowerCase()) || 0) + (+s.qty || 1)); return m; };
  const custom = () => db.list('catalog').filter((c) => !CATALOG.some((x) => x.n.toLowerCase() === c.name.toLowerCase())).map((c) => ({ n: c.name, e: c.emoji, c: c.category }));
  const grid = h('div.tile-grid'); const cats = h('div.cat-chips'); const head = h('div.picker-head');
  let input;
  const add = (name) => { addItem(name, target !== undefined ? { storeId: target } : {}); added++; draw(); counter.textContent = added ? `Fertig · ${added} hinzugefügt` : 'Fertig'; };
  const counter = h('span', null, 'Fertig');
  const draw = () => {
    const list = onList();
    const pool = [...custom(), ...CATALOG];
    const ql = q.trim().toLowerCase();
    let items;
    if (ql) items = pool.filter((x) => x.n.toLowerCase().includes(ql)).slice(0, 60);
    else if (cat === 'fav' || cat === null) {
      const top = db.list('catalog').filter((c) => c.count).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 24).map((c) => ({ n: c.name, e: c.emoji, c: c.category }));
      items = top.length >= 6 ? top : CATALOG.filter((x) => ['Milch', 'Brot', 'Eier', 'Butter', 'Bananen', 'Äpfel', 'Tomaten', 'Gurke', 'Käsescheiben', 'Joghurt', 'Nudeln', 'Kaffee', 'Toilettenpapier', 'Zahnpasta', 'Spülmittel', 'Wasser', 'Kartoffeln', 'Zwiebeln'].includes(x.n));
    } else items = pool.filter((x) => x.c === cat);
    const tiles = items.map((x) => tile({ name: x.n, emoji: x.e, cat: x.c }, () => add(x.n), list.get(x.n.toLowerCase())));
    if (ql && !pool.some((x) => x.n.toLowerCase() === ql)) {
      const name = tidy(q);
      tiles.unshift(h('button.tile.new-tile', { style: { '--t': tint(categoryOf(name)) }, onclick: () => { add(name); input.value = ''; q = ''; draw(); input.focus(); } }, h('span.tile-emoji', null, emojiOf(name)), h('span.tile-name', null, `„${name}“`), h('small', null, '+ neu: ' + categoryOf(name))));
    }
    grid.replaceChildren(...(tiles.length ? tiles : [h('p.soft', null, 'Nichts gefunden.')]));
    cats.replaceChildren(
      h('button.cat-chip' + (!cat || cat === 'fav' ? '.on' : ''), { onclick: () => { cat = 'fav'; q = ''; input.value = ''; draw(); } }, '⭐ Häufig'),
      ...CATEGORIES.map(([c, e]) => h('button.cat-chip' + (cat === c ? '.on' : ''), { onclick: () => { cat = c; q = ''; input.value = ''; draw(); grid.scrollTop = 0; } }, e + ' ' + c.split(/[,&]/)[0].trim())));
    head.replaceChildren(h('span.muted', null, 'Für:'), h('div.store-pick.compact', null,
      h('button.sp' + (target === undefined ? '.on' : ''), { onclick: () => { target = undefined; draw(); } }, 'Automatisch'),
      h('button.sp' + (target === null ? '.on' : ''), { onclick: () => { target = null; draw(); } }, 'Egal'),
      ...STORES.map((x) => h('button.sp' + (target === x.id ? '.on' : ''), { style: { '--sc': x.color, '--si': x.ink || '#fff' }, onclick: () => { target = x.id; draw(); } }, x.name))));
  };
  sheet((sh) => {
    const body = h('div.sheet-body.picker', null,
      h('div.picker-top', null,
        h('form.addbar', { onsubmit: (e) => { e.preventDefault(); if (!q.trim()) return; const parts = q.split(/\s*,\s*|\s+und\s+/).filter(Boolean); parts.forEach((x) => add(tidy(x))); input.value = ''; q = ''; draw(); } },
          input = h('input', { type: 'search', placeholder: 'Suchen oder Neues eintippen …', enterkeyhint: 'done', 'aria-label': 'Artikel suchen', oninput: (e) => { q = e.target.value; draw(); } }),
          voiceAvailable() ? h('button.icon-btn.mic', { type: 'button', 'aria-label': 'Per Sprache', onclick: () => voiceAdd(target, (n) => { added += n; draw(); counter.textContent = `Fertig · ${added} hinzugefügt`; }) }, icon('mic')) : null),
        head, cats),
      grid,
      h('div.picker-foot', null, h('button.btn.primary.big', { onclick: () => sh.close() }, icon('check', 20), counter)));
    return body;
  }, { tall: true, label: 'Artikel wählen', onClose: () => { if (added) toast(`🛒 ${added} Artikel auf der Liste`); } });
  draw();
}

/** Per Sprache: "Milch, Eier und Zahnpasta" */
export function voiceAdd(target, done) {
  toast('🎤 Ich höre zu – z. B. „Milch, Eier und Zahnpasta“');
  listen({
    onFinal: (t) => {
      const p = parse(/kauf|einkauf|brauch|besorg/i.test(t) ? t : 'Kaufe ' + t, { members: members() });
      const names = (p.items?.length ? p.items.map((i) => i.name) : [t]).filter(Boolean);
      names.forEach((n) => addItem(n, target !== undefined ? { storeId: target, silent: true } : { silent: true }));
      haptic('success'); toast(`🛒 ${names.join(', ')}`);
      done?.(names.length);
    },
    onError: (m) => { if (m) toast(m); },
  });
}
