// Haushaltsbuch: Ausgaben & Einnahmen, Monatsübersicht, Limits je Kategorie.
//   budget { kind: 'entry', type: 'out'|'in', amount (Euro), category, date, note, memberId }
//   budget { id: 'limits', kind: 'limits', limits: { Lebensmittel: 600, … } }
import { h, icon, toast, sheet, confirmSheet, fmt } from './ui.js';
import { store } from './store.js';
import { members, member, today } from './domain.js';
import { haptic } from './native.js';

import { CATEGORIES, INCOME, guessCategory } from './budgetcats.js';
export { CATEGORIES, INCOME, guessCategory };
const catEmoji = (c) => (CATEGORIES.find((x) => x[0] === c) || INCOME.find((x) => x[0] === c) || [0, '💶'])[1];
export const euro = (n) => (Math.round(n * 100) / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

const st = { month: null };
export function viewBudget() {
  const now = new Date();
  if (!st.month) st.month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const page = h('div.page');
  const rerender = () => page.replaceWith(viewBudget());
  const [y, m] = st.month.split('-').map(Number);
  const entries = store.list('budget').filter((e) => e.kind === 'entry' && e.date?.startsWith(st.month)).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const limits = store.get('budget', 'limits')?.limits || {};
  const out = entries.filter((e) => e.type === 'out'); const inc = entries.filter((e) => e.type === 'in');
  const sum = (l) => l.reduce((s, e) => s + (+e.amount || 0), 0);
  const spent = sum(out); const earned = sum(inc);
  const byCat = {}; for (const e of out) byCat[e.category] = (byCat[e.category] || 0) + (+e.amount || 0);
  const shift = (d) => { const x = new Date(y, m - 1 + d, 1); st.month = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; rerender(); };
  // Hochrechnung bis Monatsende (nur laufender Monat)
  const isNow = y === now.getFullYear() && m === now.getMonth() + 1;
  const dim = new Date(y, m, 0).getDate();
  page.append(
    h('div.page-head', null, h('a.icon-btn', { href: '#mehr', 'aria-label': 'Zurück' }, icon('left')), h('h1', null, 'Haushaltsbuch')),
    h('div.date-switch', null, h('button.icon-btn', { 'aria-label': 'Voriger Monat', onclick: () => shift(-1) }, icon('left')), h('b', null, `${fmt.MO[m - 1]} ${y}`), h('button.icon-btn', { 'aria-label': 'Nächster Monat', onclick: () => shift(1) }, icon('right'))),
    h('div.budget-head', null,
      h('div.bh-box', null, h('small', null, 'Ausgaben'), h('b.minus', null, euro(spent)), isNow && spent ? h('small', null, `Hochrechnung ≈ ${euro(spent / now.getDate() * dim)}`) : null),
      h('div.bh-box', null, h('small', null, 'Einnahmen'), h('b.plus', null, euro(earned))),
      h('div.bh-box', null, h('small', null, 'Saldo'), h('b.' + (earned - spent >= 0 ? 'plus' : 'minus'), null, euro(earned - spent)))),
    h('div.btn-row', null, h('button.btn.primary', { onclick: () => editEntry(null, 'out') }, icon('plus', 18), 'Ausgabe'), h('button.btn.tonal', { onclick: () => editEntry(null, 'in') }, icon('plus', 18), 'Einnahme'), h('button.btn.ghost', { onclick: () => editLimits(limits) }, 'Limits')),
  );
  const cats = CATEGORIES.map((c) => c[0]).filter((c) => byCat[c] || limits[c]);
  if (cats.length) page.append(h('section.section', null, h('h3.section-title', null, 'Nach Kategorie'), h('div.cat-bars', null, ...cats.map((c) => {
    const v = byCat[c] || 0; const lim = +limits[c] || 0; const pct = lim ? v / lim : v / Math.max(...Object.values(byCat));
    return h('div.cat-bar' + (lim && v > lim ? '.over' : lim && v > lim * 0.85 ? '.near' : ''), null,
      h('div.cb-top', null, h('span', null, catEmoji(c), ' ', c), h('b', null, euro(v), lim ? h('small', null, ` / ${euro(lim)}`) : null)),
      h('div.progress', null, h('i', { style: { width: Math.min(100, pct * 100) + '%' } })),
      lim && v > lim ? h('small.warn', null, `${euro(v - lim)} über dem Limit`) : null);
  }))));
  page.append(h('section.section', null, h('h3.section-title', null, `Buchungen · ${entries.length}`),
    entries.length ? h('div.list.compact', null, ...entries.map((e) => h('button.item.budget-row', { onclick: () => editEntry(e) },
      h('span.br-emoji', null, catEmoji(e.category)),
      h('div.what', null, h('div.title', null, e.note || e.category), h('div.meta', null, h('span', null, fmt.dayLabel(e.date)), h('span', null, e.category), e.memberId ? h('span', null, member(e.memberId)?.name || '') : null)),
      h('b.' + (e.type === 'in' ? 'plus' : 'minus'), null, (e.type === 'in' ? '+' : '−') + euro(+e.amount))))) : h('p.soft', null, 'Noch keine Buchungen. Tipp per Sprache: „35 Euro bei Rewe ausgegeben“.')));
  return page;
}

export function editEntry(e, type = 'out') {
  const v = { type, amount: '', category: type === 'in' ? 'Gehalt' : 'Lebensmittel', date: today(), note: '', memberId: store.config.meId, ...(e || {}) };
  const f = {}; let cat = v.category;
  const cats = v.type === 'in' ? INCOME.map(([c, em]) => [c, em]) : CATEGORIES.map(([c, em]) => [c, em]);
  const chips = h('div.chips');
  const draw = () => chips.replaceChildren(...cats.map(([c, em]) => h('button.chip' + (cat === c ? '.removable' : ''), { type: 'button', onclick: () => { cat = c; draw(); } }, em + ' ' + c)));
  draw();
  sheet((s) => h('form.sheet-body', { onsubmit: (ev) => {
    ev.preventDefault();
    const amount = parseFloat(String(f.amount.value).replace(',', '.'));
    if (!(amount > 0)) return f.amount.focus();
    store.put('budget', { ...(e || {}), kind: 'entry', type: v.type, amount: Math.round(amount * 100) / 100, category: cat, date: f.date.value || today(), note: f.note.value.trim(), memberId: f.who.value || null });
    haptic('success'); s.close(); toast(`${v.type === 'in' ? 'Einnahme' : 'Ausgabe'} gespeichert`);
  } },
  h('h2.sheet-title', null, e ? 'Buchung bearbeiten' : v.type === 'in' ? 'Neue Einnahme' : 'Neue Ausgabe'),
  h('label.field.amount', null, h('span', null, 'Betrag in €'), f.amount = h('input', { value: v.amount ? String(v.amount).replace('.', ',') : '', inputmode: 'decimal', placeholder: '0,00', autofocus: !e, required: true })),
  h('label.field', null, h('span', null, 'Kategorie'), chips),
  h('div.row2', null,
    h('label.field', null, h('span', null, 'Datum'), f.date = h('input', { type: 'date', value: v.date })),
    h('label.field', null, h('span', null, 'Wer?'), f.who = h('select', null, h('option', { value: '' }, '–'), ...members().map((m) => h('option', { value: m.id, selected: m.id === v.memberId }, m.name))))),
  h('label.field', null, h('span', null, 'Notiz'), f.note = h('input', { value: v.note, placeholder: 'z. B. Wocheneinkauf', oninput: (ev) => { if (!e && v.type === 'out') { const g = guessCategory(ev.target.value); if (g !== 'Sonstiges') { cat = g; draw(); } } } })),
  h('div.btn-row', null,
    e ? h('button.btn.danger-ghost', { type: 'button', onclick: async () => { if (await confirmSheet({ title: 'Buchung löschen?', ok: 'Löschen', danger: true })) { store.del('budget', e.id); s.close(); } } }, icon('trash', 18), 'Löschen') : h('span'),
    h('button.btn.primary', { type: 'submit' }, 'Speichern'))), { tall: true, label: 'Buchung' });
}

function editLimits(limits) {
  const f = {};
  sheet((s) => h('form.sheet-body', { onsubmit: (ev) => {
    ev.preventDefault();
    const out = {}; for (const [c] of CATEGORIES) { const n = parseFloat(String(f[c].value).replace(',', '.')); if (n > 0) out[c] = n; }
    store.put('budget', { id: 'limits', kind: 'limits', limits: out }); s.close(); toast('Limits gespeichert');
  } },
  h('h2.sheet-title', null, 'Monatliche Limits'),
  h('p.muted', null, 'Wie viel darf pro Monat in jede Kategorie fließen? Leer = kein Limit. Bei 85 % wird die Leiste gelb, darüber rot.'),
  ...CATEGORIES.map(([c, em]) => h('label.field.inline', null, h('span', null, em + ' ' + c), f[c] = h('input', { value: limits[c] ?? '', inputmode: 'decimal', placeholder: '–' }))),
  h('div.btn-row', null, h('span'), h('button.btn.primary', { type: 'submit' }, 'Speichern'))), { tall: true, label: 'Limits' });
}
