// Pinnwand (Familien-Nachrichten), Kontakte, eigene Listen und Stundenplan.
//   messages  { text, authorId, pinned, reactions: { '❤️': [memberId…] } }
//   contacts  { name, category, phone, phone2, email, address, notes, memberIds }
//   lists     { title, emoji, order }      listitems { listId, text, done, order }
//   timetable { id: 'tt_<memberId>', memberId, periods: [{start,end}], days: { 1: ['Mathe', …], … 5: [] } }
import { h, icon, toast, sheet, confirmSheet, promptSheet, fmt } from './ui.js';
import { store } from './store.js';
import { members, member, childMode, today } from './domain.js';
import { openUrl, haptic } from './native.js';
import { avatars } from './views.js';

const field = (label, input) => h('label.field', null, h('span', null, label), input);
const back = (title, to = 'mehr') => h('div.page-head', null, h('a.icon-btn', { href: '#' + to, 'aria-label': 'Zurück' }, icon('left')), h('h1', null, title));
const me = () => childMode() || member(store.config.meId);

// ================= Pinnwand =================
const REACT = ['❤️', '👍', '😂', '🎉', '🙏'];
function timeLabel(ts) {
  const d = new Date(ts); const td = new Date();
  const same = d.toDateString() === td.toDateString();
  return same ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : `${fmt.dayLabel(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function viewBoard() {
  const page = h('div.page.board');
  const msgs = store.list('messages').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const pinned = msgs.filter((m) => m.pinned);
  const author = me();
  let input;
  const send = () => {
    const text = input.value.trim(); if (!text) return;
    if (!author) return toast('Bitte unter „Familie“ festlegen, wer dieses Handy nutzt');
    store.put('messages', { text, authorId: author.id, reactions: {}, pinned: false });
    haptic('success');
    // sofort neu zeichnen (die App wartet sonst, bis das Eingabefeld verlassen wird)
    const next = viewBoard(); page.replaceWith(next); next.querySelector('.composer input')?.focus();
  };
  const bubble = (m) => {
    const a = member(m.authorId); const mine = author && m.authorId === author.id;
    const reacts = Object.entries(m.reactions || {}).filter(([, ids]) => ids.length);
    return h('div.msg' + (mine ? '.mine' : '') + (m.pinned ? '.pinned' : ''), { style: { '--c': a?.color || 'var(--muted)' } },
      mine ? null : h('span.av', { style: { '--c': a?.color } }, a?.emoji || a?.name?.[0] || '?'),
      h('div.bubble', { onclick: () => msgMenu(m, mine) },
        mine ? null : h('b.msg-author', null, a?.name || 'Unbekannt'),
        h('p', null, m.text),
        h('small', null, (m.pinned ? '📌 ' : '') + timeLabel(m.createdAt)),
        reacts.length ? h('span.reacts', null, ...reacts.map(([e, ids]) => h('span', null, e, ids.length > 1 ? ids.length : ''))) : null));
  };
  page.append(back('Pinnwand'),
    pinned.length ? h('div.pinned-box', null, h('h3.section-title', null, '📌 Angeheftet'), ...pinned.map((m) => h('div.pin-note', { onclick: () => msgMenu(m, author && m.authorId === author.id) }, m.text, h('small', null, ' – ' + (member(m.authorId)?.name || ''))))) : null,
    msgs.length ? h('div.msgs', null, ...msgs.slice(-150).map(bubble)) : h('div.empty', null, icon('users', 36), h('p', null, 'Die Familien-Pinnwand: kurze Nachrichten, Absprachen, „Bin um 6 zuhause“. Alle sehen sie, wichtige lassen sich anheften.')),
    h('form.addbar.composer', { onsubmit: (e) => { e.preventDefault(); send(); } },
      input = h('input', { placeholder: author ? `Nachricht als ${author.name} …` : 'Nachricht …', enterkeyhint: 'send', 'aria-label': 'Nachricht' }),
      h('button.icon-btn.primary', { type: 'submit', 'aria-label': 'Senden' }, icon('right'))));
  setTimeout(() => { const v = document.getElementById('view'); if (v) v.scrollTop = v.scrollHeight; }, 30);
  return page;
}
function msgMenu(m, mine) {
  const author = me();
  sheet((s) => h('div.sheet-body', null,
    h('p.answer-text', null, m.text),
    h('div.react-row', null, ...REACT.map((e) => h('button.react-btn', { onclick: () => {
      if (!author) return toast('Bitte unter „Familie“ festlegen, wer dieses Handy nutzt');
      const r = { ...(m.reactions || {}) }; const ids = new Set(r[e] || []);
      ids.has(author.id) ? ids.delete(author.id) : ids.add(author.id); r[e] = [...ids];
      store.put('messages', { ...m, reactions: r }); s.close();
    } }, e))),
    h('div.menu', null,
      h('button.menu-row', { onclick: () => { store.put('messages', { ...m, pinned: !m.pinned }); s.close(); } }, h('span.mi.emoji-mi', null, '📌'), h('span.mt', null, h('b', null, m.pinned ? 'Nicht mehr anheften' : 'Anheften'))),
      mine || !childMode() ? h('button.menu-row', { onclick: () => { store.del('messages', m.id); s.close(); toast('Gelöscht', { label: 'Rückgängig', run: () => store.put('messages', m) }); } }, h('span.mi', null, icon('trash', 20)), h('span.mt', null, h('b', null, 'Löschen'))) : null)), { label: 'Nachricht' });
}
export function boardTeaser() {
  const msgs = store.list('messages').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!msgs.length) return null;
  const pin = msgs.find((m) => m.pinned); const last = msgs[0];
  const items = [pin, last !== pin ? last : null].filter(Boolean);
  return h('section.section', null, h('h3.section-title', null, 'Pinnwand'),
    h('a.card.board-teaser', { href: '#pinnwand' }, ...items.map((m) => h('div.bt-row', null, h('span.av', { style: { '--c': member(m.authorId)?.color } }, member(m.authorId)?.emoji || member(m.authorId)?.name?.[0] || '?'), h('span.bt-text', null, (m.pinned ? '📌 ' : '') + m.text), h('small', null, timeLabel(m.createdAt))))));
}

// ================= Kontakte =================
const CATS = [['emergency', '🚨 Notfall'], ['doctor', '🩺 Ärzte & Gesundheit'], ['school', '🏫 Schule & Kita'], ['care', '🧸 Betreuung'], ['family', '👪 Familie & Freunde'], ['service', '🔧 Handwerk & Service'], ['other', '📇 Sonstiges']];
const EMERGENCY = [['Notruf (Feuerwehr, Rettung)', '112'], ['Polizei', '110'], ['Ärztlicher Bereitschaftsdienst', '116117'], ['Giftnotruf (Berlin)', '03019240']];
const cstate = { q: '' };
export function viewContacts() {
  const page = h('div.page');
  const q = cstate.q.toLowerCase();
  const all = store.list('contacts').filter((c) => !q || `${c.name} ${c.notes || ''} ${c.phone || ''}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  page.append(back('Kontakte'),
    h('div.addbar', null, h('input', { type: 'search', value: cstate.q, placeholder: 'Suchen – z. B. Kinderarzt', oninput: (e) => { cstate.q = e.target.value; const n = viewContacts(); page.replaceWith(n); const i = n.querySelector('input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }),
      childMode() ? null : h('button.icon-btn.primary', { 'aria-label': 'Kontakt hinzufügen', onclick: () => editContact(null) }, icon('plus'))));
  if (!q) page.append(h('section.section', null, h('h3.section-title', null, '🚨 Notrufnummern'), h('div.menu', null, ...EMERGENCY.map(([n, t]) => h('button.menu-row', { onclick: () => openUrl('tel:' + t) }, h('span.mi.emoji-mi', null, '📞'), h('span.mt', null, h('b', null, n), h('small', null, t)), icon('right', 18))))));
  if (!store.list('contacts').length) page.append(h('div.card.tip', null, h('p', null, 'Wichtige Nummern für alle griffbereit: Kinderarzt, Kita, Babysitter, Schule, Handwerker … Ein Tipp ruft direkt an.'), childMode() ? null : h('button.btn.tonal', { onclick: () => editContact(null) }, icon('plus', 18), 'Ersten Kontakt anlegen')));
  for (const [k, label] of CATS) {
    const list = all.filter((c) => (c.category || 'other') === k);
    if (!list.length) continue;
    page.append(h('section.section', null, h('h3.section-title', null, label), h('div.menu', null, ...list.map((c) => h('button.menu-row', { onclick: () => showContact(c) },
      h('span.mi.emoji-mi', null, label.split(' ')[0]), h('span.mt', null, h('b', null, c.name), h('small', null, [c.phone, c.notes].filter(Boolean).join(' · '))), avatars(c.memberIds))))));
  }
  return page;
}
function showContact(c) {
  const tel = (n) => 'tel:' + n.replace(/[^\d+]/g, '');
  sheet((s) => h('div.sheet-body', null,
    h('h2.sheet-title', null, c.name),
    c.notes ? h('p.muted', null, c.notes) : null,
    h('div.btn-col', null,
      c.phone ? h('button.btn.primary', { onclick: () => openUrl(tel(c.phone)) }, '📞 Anrufen · ', c.phone) : null,
      c.phone2 ? h('button.btn.tonal', { onclick: () => openUrl(tel(c.phone2)) }, '📞 ', c.phone2) : null,
      c.phone ? h('button.btn.tonal', { onclick: () => openUrl('sms:' + c.phone.replace(/[^\d+]/g, '')) }, '💬 SMS schreiben') : null,
      c.email ? h('button.btn.tonal', { onclick: () => openUrl('mailto:' + c.email) }, '✉️ ', c.email) : null,
      c.address ? h('button.btn.tonal', { onclick: () => openUrl('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.address)) }, '📍 ', c.address) : null,
      childMode() ? null : h('button.btn.ghost', { onclick: () => { s.close(); editContact(c); } }, icon('edit', 18), 'Bearbeiten'))), { label: c.name });
}
function editContact(c) {
  const v = { name: '', category: 'doctor', phone: '', phone2: '', email: '', address: '', notes: '', memberIds: [], ...(c || {}) };
  const f = {}; const sel = new Set(v.memberIds);
  const ppl = h('div.chips.people');
  const drawP = () => ppl.replaceChildren(...members().map((m) => h('button.person' + (sel.has(m.id) ? '.on' : ''), { type: 'button', style: { '--c': m.color }, onclick: () => { sel.has(m.id) ? sel.delete(m.id) : sel.add(m.id); drawP(); } }, h('span.av', null, m.emoji || m.name[0]), m.name)));
  drawP();
  sheet((s) => h('form.sheet-body', { onsubmit: (e) => {
    e.preventDefault(); const name = f.name.value.trim(); if (!name) return;
    store.put('contacts', { ...(c || {}), name, category: f.cat.value, phone: f.phone.value.trim(), phone2: f.phone2.value.trim(), email: f.email.value.trim(), address: f.address.value.trim(), notes: f.notes.value.trim(), memberIds: [...sel] });
    s.close(); toast('Kontakt gespeichert');
  } },
  h('h2.sheet-title', null, c ? 'Kontakt bearbeiten' : 'Neuer Kontakt'),
  field('Name', f.name = h('input', { value: v.name, required: true, autofocus: !c, placeholder: 'z. B. Kinderarzt Dr. Weber' })),
  field('Bereich', f.cat = h('select', null, ...CATS.map(([k, l]) => h('option', { value: k, selected: v.category === k }, l)))),
  h('div.row2', null, field('Telefon', f.phone = h('input', { type: 'tel', value: v.phone })), field('2. Nummer', f.phone2 = h('input', { type: 'tel', value: v.phone2 }))),
  field('E-Mail', f.email = h('input', { type: 'email', value: v.email })),
  field('Adresse', f.address = h('input', { value: v.address })),
  field('Notiz', f.notes = h('input', { value: v.notes, placeholder: 'z. B. Sprechzeiten Mo–Fr 8–12' })),
  members().length ? field('Für wen?', ppl) : null,
  h('div.btn-row', null,
    c ? h('button.btn.danger-ghost', { type: 'button', onclick: async () => { if (await confirmSheet({ title: `${c.name} löschen?`, ok: 'Löschen', danger: true })) { store.del('contacts', c.id); s.close(); } } }, icon('trash', 18), 'Löschen') : h('span'),
    h('button.btn.primary', { type: 'submit' }, 'Speichern'))), { tall: true, label: 'Kontakt' });
}

// ================= Listen =================
const TEMPLATES = {
  '🧳 Packliste Urlaub': ['Ausweise & Reisepässe', 'Krankenkassenkarten', 'Ladekabel', 'Sonnencreme', 'Badesachen', 'Schlafanzüge', 'Zahnbürsten', 'Medikamente', 'Kuscheltier', 'Snacks für die Fahrt'],
  '🎁 Geschenkideen': [], '🎬 Filme & Serien': [], '📚 Bücher': [], '🏡 Haus & Garten': [], '✨ Wunschliste': [],
};
export function viewLists() {
  const page = h('div.page');
  const lists = store.list('lists').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
  const items = store.list('listitems');
  page.append(back('Listen'),
    h('p.muted', null, 'Eigene Listen für alles außer dem Einkauf – Packliste, Geschenkideen, Filmabend …'),
    lists.length ? h('div.menu', null, ...lists.map((l) => {
      const its = items.filter((i) => i.listId === l.id); const open = its.filter((i) => !i.done).length;
      return h('a.menu-row', { href: '#liste-' + l.id }, h('span.mi.emoji-mi', null, l.emoji || '📝'), h('span.mt', null, h('b', null, l.title), h('small', null, its.length ? `${open} offen · ${its.length - open} erledigt` : 'leer')), icon('right', 18));
    })) : null,
    childMode() ? null : h('section.section', null, h('h3.section-title', null, 'Neue Liste'), h('div.chips', null,
      ...Object.keys(TEMPLATES).map((t) => h('button.chip', { onclick: () => { const l = store.put('lists', { title: t.slice(t.indexOf(' ') + 1), emoji: t.split(' ')[0], order: lists.length }); store.putMany('listitems', TEMPLATES[t].map((text, i) => ({ listId: l.id, text, done: false, order: i }))); location.hash = 'liste-' + l.id; } }, t)),
      h('button.chip', { onclick: async () => { const t = await promptSheet({ title: 'Neue Liste', label: 'Name', placeholder: 'z. B. Geburtstagsparty' }); if (t) { const l = store.put('lists', { title: t, emoji: '📝', order: lists.length }); location.hash = 'liste-' + l.id; } } }, '+ Eigene'))));
  return page;
}
export function viewList(id) {
  const l = store.get('lists', id);
  if (!l) { location.hash = 'listen'; return h('div'); }
  const page = h('div.page');
  const items = store.list('listitems').filter((i) => i.listId === id).sort((a, b) => (a.done - b.done) || (a.order ?? 0) - (b.order ?? 0));
  let input;
  page.append(h('div.page-head', null, h('a.icon-btn', { href: '#listen', 'aria-label': 'Zurück' }, icon('left')), h('h1', null, `${l.emoji || ''} ${l.title}`),
    childMode() ? null : h('button.icon-btn', { 'aria-label': 'Liste bearbeiten', onclick: async () => {
      const r = await confirmSheet({ title: l.title, ok: 'Umbenennen', extra: 'Erledigte zurücksetzen', cancel: 'Liste löschen' });
      if (r === true) { const t = await promptSheet({ title: 'Umbenennen', label: 'Name', value: l.title }); if (t) store.put('lists', { ...l, title: t }); }
      else if (r === 'extra') items.filter((i) => i.done).forEach((i) => store.put('listitems', { ...i, done: false }));
      else if (r === false && await confirmSheet({ title: `„${l.title}“ löschen?`, ok: 'Löschen', danger: true })) { items.forEach((i) => store.del('listitems', i.id)); store.del('lists', l.id); location.hash = 'listen'; }
    } }, icon('more'))),
  h('form.addbar', { onsubmit: (e) => { e.preventDefault(); const parts = input.value.split(/\s*,\s*/).filter(Boolean); if (!parts.length) return; store.putMany('listitems', parts.map((text, k) => ({ listId: id, text, done: false, order: items.length + k }))); input.value = ''; input.focus(); } },
    input = h('input', { placeholder: 'Eintrag hinzufügen – mehrere mit Komma', 'aria-label': 'Eintrag' }), h('button.icon-btn.primary', { type: 'submit', 'aria-label': 'Hinzufügen' }, icon('plus'))),
  items.length ? h('div.list.compact', null, ...items.map((i) => h('div.item.shop' + (i.done ? '.done' : ''), null,
    h('button.check' + (i.done ? '.on' : ''), { 'aria-label': 'Abhaken', onclick: () => { haptic(); store.put('listitems', { ...i, done: !i.done }); } }, icon('check', 16)),
    h('div.what', null, h('div.title', null, i.text)),
    h('button.icon-btn', { 'aria-label': 'Entfernen', onclick: () => store.del('listitems', i.id) }, icon('close', 16))))) : h('p.soft', null, 'Noch leer.'));
  return page;
}

// ================= Stundenplan =================
const DEFAULT_PERIODS = [['08:00', '08:45'], ['08:50', '09:35'], ['09:55', '10:40'], ['10:45', '11:30'], ['11:45', '12:30'], ['12:35', '13:20'], ['13:30', '14:15'], ['14:20', '15:05']].map(([start, end]) => ({ start, end }));
const SUBJECTS = ['Deutsch', 'Mathe', 'Englisch', 'Sachkunde', 'Sport', 'Musik', 'Kunst', 'Religion', 'Ethik', 'Biologie', 'Geschichte', 'Erdkunde', 'Physik', 'Chemie', 'Französisch', 'Latein', 'Informatik', 'AG', 'Förderunterricht', 'Pause'];
const DAYS = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr']];
const ttId = (mid) => 'tt_' + String(mid).replace(/[^A-Za-z0-9_-]/g, '');
export function timetableFor(memberId) { return store.get('timetable', ttId(memberId)); }
export function lessonsOn(memberId, date) {
  const tt = timetableFor(memberId); if (!tt) return [];
  const wd = fmt.parse(date).getDay();
  return (tt.days?.[wd] || []).map((s, i) => ({ subject: s, ...(tt.periods || DEFAULT_PERIODS)[i] })).filter((x) => x.subject && x.subject !== 'Pause');
}
const tstate = { member: null };
export function viewTimetable() {
  const kids = childMode() ? [childMode()] : members().filter((m) => m.role === 'child');
  const page = h('div.page');
  page.append(back('Stundenplan'));
  if (!kids.length) { page.append(h('div.card.tip', null, h('p', null, 'Lege unter „Familie“ Kinder an (Rolle „Kind“), dann kannst du hier ihren Stundenplan eintragen.'), h('a.btn.tonal', { href: '#familie' }, 'Zur Familie'))); return page; }
  if (!tstate.member || !kids.some((k) => k.id === tstate.member)) tstate.member = kids[0].id;
  const kid = member(tstate.member);
  const tt = timetableFor(kid.id) || { id: ttId(kid.id), memberId: kid.id, periods: DEFAULT_PERIODS, days: {} };
  const periods = tt.periods || DEFAULT_PERIODS;
  const todayWd = new Date().getDay();
  const rows = Math.max(4, ...DAYS.map(([d]) => (tt.days?.[d] || []).length));
  if (kids.length > 1) page.append(h('div.filter.tight', null, ...kids.map((k) => h('button.fchip' + (k.id === kid.id ? '.on' : ''), { style: { '--c': k.color }, onclick: () => { tstate.member = k.id; page.replaceWith(viewTimetable()); } }, h('span.dot'), k.name))));
  const grid = h('div.tt-grid', { style: { '--rows': Math.min(rows + 1, periods.length) } },
    h('div.tt-corner'), ...DAYS.map(([d, l]) => h('div.tt-day' + (d === todayWd ? '.today' : ''), null, l)));
  for (let i = 0; i < Math.min(rows + 1, periods.length); i++) {
    grid.append(h('div.tt-time', null, h('b', null, i + 1 + '.'), h('small', null, periods[i].start)));
    for (const [d] of DAYS) {
      const subj = tt.days?.[d]?.[i] || '';
      grid.append(h('button.tt-cell' + (subj ? '.set' : '') + (d === todayWd ? '.today' : ''), { style: { '--c': subjectColor(subj) }, onclick: () => !childMode() && editLesson(kid, tt, d, i) }, subj || (childMode() ? '' : '+')));
    }
  }
  page.append(grid, h('p.hint', null, childMode() ? '' : 'Tippe auf ein Feld, um ein Fach einzutragen. Der Stundenplan erscheint morgens auf „Heute“ und kann per Sprache abgefragt werden: „Was hat Lena morgen in der Schule?“'));
  return page;
}
function subjectColor(s) {
  if (!s) return 'var(--line)';
  let x = 0; for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${x} 55% 55%)`;
}
function editLesson(kid, tt, day, idx) {
  const save = (val, s) => {
    const days = { ...(tt.days || {}) }; const arr = [...(days[day] || [])];
    while (arr.length <= idx) arr.push('');
    arr[idx] = val; while (arr.length && !arr[arr.length - 1]) arr.pop();
    days[day] = arr;
    store.put('timetable', { ...tt, days, periods: tt.periods || DEFAULT_PERIODS });
    s.close();
  };
  let input;
  const used = [...new Set(Object.values(tt.days || {}).flat().filter(Boolean))];
  sheet((s) => h('div.sheet-body', null,
    h('h2.sheet-title', null, `${kid.name} · ${DAYS.find(([d]) => d === day)[1]}, ${idx + 1}. Stunde`),
    h('form.addbar', { onsubmit: (e) => { e.preventDefault(); save(input.value.trim(), s); } }, input = h('input', { value: tt.days?.[day]?.[idx] || '', placeholder: 'Fach', autofocus: true }), h('button.icon-btn.primary', { type: 'submit', 'aria-label': 'Speichern' }, icon('check'))),
    h('div.chips', null, ...[...used, ...SUBJECTS.filter((x) => !used.includes(x))].map((x) => h('button.chip', { onclick: () => save(x, s) }, x))),
    h('div.btn-row', null, h('button.btn.danger-ghost', { onclick: () => save('', s) }, icon('trash', 18), 'Leeren'), h('span'))), { tall: true, label: 'Stunde' });
}
/** Für „Heute“: Unterricht der Kinder */
export function todaySchoolCard() {
  const now = new Date(); const wd = now.getDay();
  if (wd === 0 || wd === 6) return null;
  const date = now.getHours() >= 15 ? fmt.parse(today()) : null;
  const target = date ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + (wd === 5 ? 3 : 1)) : now;
  const ds = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
  const kids = childMode() ? [childMode()] : members().filter((m) => m.role === 'child');
  const rows = kids.map((k) => [k, lessonsOn(k.id, ds)]).filter(([, l]) => l.length);
  if (!rows.length) return null;
  return h('section.section', null, h('h3.section-title', null, date ? `Schule ${fmt.dayLabel(ds)}` : 'Schule heute'),
    h('a.card.school-today', { href: '#stundenplan' }, ...rows.map(([k, l]) => h('div.st-row', null, h('span.av', { style: { '--c': k.color } }, k.emoji || k.name[0]), h('span.st-main', null, h('b', null, k.name), h('small', null, l.map((x) => x.subject).join(' · '))), h('small.st-end', null, 'bis ' + (l[l.length - 1].end || ''))))));
}
