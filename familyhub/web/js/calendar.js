// Kalender nach Vorlage: dunkle Seitenleiste (Mini-Monat, Meine Kalender, Personen) + Hauptfläche mit
// Verlaufs-Kopf, großen Tageskarten und Zeitraster mit Pastell-Blöcken. Ansichten: Monat · Woche · Tag · Liste.
import { h, icon, fmt, mono, sheet } from './ui.js';
import { store } from './store.js';
import { agenda, openTasks, sortTasks, members, member, childMode, today } from './domain.js';
import { ymd, addDays } from './nlp.js';
import { openEditor } from './editors.js';
import { haptic } from './native.js';
import { eventRow, taskRow, isoWeek, showExternal } from './views.js';
import { choresFor, toggleChore } from './household.js';
import { calendars } from './extcal.js';

const cal = { mode: null, cursor: null, selected: null };
const HOUR_H = () => (innerWidth < 720 ? 58 : 66);
const P = (d) => fmt.parse(d);
const minutes = (t) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
const sourceKey = (e) => (e.waste ? 'waste' : e.calName ? 'ext:' + e.calName : 'own');
const hidden = () => new Set(store.config.calHidden || []);
const visible = (e) => !hidden().has(sourceKey(e));
const colorOf = (e) => e.calColor || (e.memberIds?.length ? member(e.memberIds[0])?.color : null) || '#8B7CF6';

export function viewCalendar() {
  const now = new Date();
  if (!cal.mode) cal.mode = innerWidth < 720 ? 'day' : 'week';
  if (!cal.selected) cal.selected = today();
  if (!cal.cursor) cal.cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (document.documentElement.getAttribute('data-theme') !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const page = h('div.page.cal2' + (dark ? '.dark' : ''));
  const rerender = () => { const y = page.querySelector('.tg-scroll')?.scrollTop; const n = viewCalendar(); page.replaceWith(n); if (y != null) { const s = n.querySelector('.tg-scroll'); if (s) s.scrollTop = y; } };
  const go = (d) => { cal.selected = d; const x = P(d); cal.cursor = new Date(x.getFullYear(), x.getMonth(), 1); rerender(); };

  page.append(h('div.cal2-layout', null, sidebar(go, rerender), mainPanel(go, rerender)));
  return page;
}

// ---------------- Seitenleiste ----------------
function sidebar(go, rerender) {
  const td = today();
  const c = cal.cursor;
  const start = addDays(c, -((c.getDay() + 6) % 7));
  const evDays = new Set(agenda(ymd(start), ymd(addDays(start, 41))).filter(visible).map((e) => e.date));
  const mini = h('div.cs-panel', null,
    h('div.cs-head', null, h('b', null, `${fmt.MO[c.getMonth()]} ${c.getFullYear()}`),
      h('button.cs-arrow', { 'aria-label': 'Voriger Monat', onclick: () => { cal.cursor = new Date(c.getFullYear(), c.getMonth() - 1, 1); rerender(); } }, icon('left', 18)),
      h('button.cs-arrow', { 'aria-label': 'Nächster Monat', onclick: () => { cal.cursor = new Date(c.getFullYear(), c.getMonth() + 1, 1); rerender(); } }, icon('right', 18))),
    h('div.cs-mini', null, ...['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => h('span.cs-wd', null, d)),
      ...[...Array(42)].map((_, i) => { const d = addDays(start, i); const k = ymd(d); return h('button.cs-day' + (k === td ? '.today' : '') + (k === cal.selected ? '.sel' : '') + (d.getMonth() !== c.getMonth() ? '.out' : '') + (evDays.has(k) ? '.has' : ''), { onclick: () => go(k), 'aria-label': fmt.longDate(d) }, d.getDate()); })));
  const hid = hidden();
  const toggle = (key) => { const s = hidden(); s.has(key) ? s.delete(key) : s.add(key); store.saveConfig({ calHidden: [...s] }); rerender(); };
  const srcs = [['own', 'Familie', 'var(--cal-lav)'], ...calendars().filter((x) => x.kind !== 'waste').map((x) => ['ext:' + x.name, x.name, x.color || '#7CC4E8']), ['tasks', 'Aufgaben', '#F2C14E'], ['chores', 'Ämter', '#7ED3A8']];
  if (calendars().some((x) => x.kind === 'waste')) srcs.push(['waste', 'Abfall', '#B9C2CF']);
  const cals = h('details.cs-panel', { open: true }, h('summary.cs-head', null, h('b', null, 'Meine Kalender'), icon('chevron-down', 18)),
    h('div.cs-list', null, ...srcs.map(([k, l, col]) => h('label.cs-check', null, h('input', { type: 'checkbox', checked: !hid.has(k), onchange: () => toggle(k) }), h('span.cs-box', { style: { '--c': col } }, icon('check', 12)), l))));
  const cur = store.config.filterMember;
  const ppl = members();
  const cats = h('details.cs-panel', { open: true }, h('summary.cs-head', null, h('b', null, 'Personen'), icon('chevron-down', 18)),
    h('div.cs-list', null,
      h('button.cs-cat' + (!cur ? '.on' : ''), { onclick: () => store.saveConfig({ filterMember: null }) }, h('i', { style: { background: '#fff' } }), 'Alle'),
      ...ppl.map((m) => h('button.cs-cat' + (cur === m.id ? '.on' : ''), { onclick: () => store.saveConfig({ filterMember: cur === m.id ? null : m.id }) }, h('i', { style: { background: m.color } }), m.name))));
  const fam = h('div.cs-avs', null, ...ppl.slice(0, 6).map((m) => h('span.av', { style: { '--c': m.color }, title: m.name }, mono(m))), h('a.cs-more', { href: '#familie', 'aria-label': 'Familie' }, icon('more', 18)));
  return h('aside.cal2-side', null, mini, cals, childMode() ? null : cats, fam);
}

// ---------------- Hauptfläche ----------------
function mainPanel(go, rerender) {
  const mode = cal.mode;
  const sel = P(cal.selected);
  const wkStart = ymd(addDays(sel, -((sel.getDay() + 6) % 7)));
  const shift = (dir) => {
    if (mode === 'month') { cal.cursor = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth() + dir, 1); rerender(); return; }
    go(ymd(addDays(sel, (mode === 'week' ? 7 : mode === 'list' ? 7 : 1) * dir)));
  };
  const titleDate = mode === 'month' ? cal.cursor : sel;
  const head = h('div.cm-head', null,
    h('div.cm-title', null, h('h1', null, `${fmt.MO[titleDate.getMonth()]} ${titleDate.getFullYear()}`),
      h('button.cm-today', { onclick: () => { const n = new Date(); cal.cursor = new Date(n.getFullYear(), n.getMonth(), 1); go(today()); } }, 'Heute'),
      h('button.cm-arrow', { 'aria-label': 'Zurück', onclick: () => shift(-1) }, icon('left', 20)),
      h('button.cm-arrow', { 'aria-label': 'Weiter', onclick: () => shift(1) }, icon('right', 20))),
    h('button.cm-new', { onclick: () => openEditor('events', null, { date: cal.selected }), 'aria-label': 'Neuer Termin' }, icon('plus', 18), h('span', null, 'Termin')),
    h('div.cm-seg', { role: 'tablist' }, ...[['month', 'Monat'], ['week', 'Woche'], ['day', 'Tag'], ['list', 'Liste']].map(([k, l]) => h('button' + (mode === k ? '.on' : ''), { role: 'tab', 'aria-selected': mode === k, onclick: () => { cal.mode = k; rerender(); } }, l))));
  const body = mode === 'month' ? monthView(go) : mode === 'list' ? listView() : timeGrid(mode === 'week' ? [...Array(7)].map((_, i) => ymd(addDays(P(wkStart), i))) : [cal.selected], go, wkStart);
  return h('section.cal2-main', null, h('div.cm-glow'), head, body);
}

// ---------------- Zeitraster (Woche / Tag) ----------------
function timeGrid(days, go, wkStart) {
  const td = today();
  const HH = HOUR_H();
  const evs = agenda(days[0], days[days.length - 1]).filter(visible);
  const tasks = hidden().has('tasks') ? [] : sortTasks(openTasks().filter((t) => t.date && t.date >= days[0] && t.date <= days[days.length - 1]));
  const timed = evs.filter((e) => !e.allDay && e.time);
  const mins = [...timed.map((e) => minutes(e.time)), ...tasks.filter((t) => t.time).map((t) => minutes(t.time))];
  const ends = timed.map((e) => minutes(e.endTime) ?? minutes(e.time) + 60);
  const from = Math.max(0, Math.min(7, ...mins.map((m) => Math.floor(m / 60))));
  const to = Math.min(24, Math.max(21, ...ends.map((m) => Math.ceil(m / 60))));
  const hours = [...Array(to - from)].map((_, i) => from + i);

  // Kopf: große Tageskarten
  const strip = h('div.tg-days', { style: { '--n': days.length } },
    h('div.tg-corner', null, h('span', null, `KW ${isoWeek(P(days[0]))}`)),
    ...days.map((d) => {
      const x = P(d); const past = d < td;
      return h('button.tg-dcard' + (d === td ? '.today' : past ? '.past' : '') + (d === cal.selected && days.length > 1 ? '.sel' : ''), { onclick: () => { cal.mode = 'day'; go(d); } },
        h('span.tg-wd', null, fmt.WD[x.getDay()].toLowerCase()), h('b', null, x.getDate()));
    }));

  // Ganztägig + Ämter je Tag
  const allDay = h('div.tg-allday', { style: { '--n': days.length } }, h('div.tg-corner.small', null, 'ganzt.'),
    ...days.map((d) => {
      const items = evs.filter((e) => e.allDay && e.date <= d && (e.endDate || e.date) >= d);
      const ch = hidden().has('chores') ? [] : choresFor(d, childMode()?.id);
      const dt = tasks.filter((t) => t.date === d && !t.time);
      return h('div.tg-adcell', null,
        ...items.map((e) => h('button.tg-chip', { style: { '--c': colorOf(e) }, onclick: (ev) => detail(e, ev.currentTarget) }, e.title)),
        ...dt.map((t) => h('button.tg-chip.task', { onclick: () => openEditor('tasks', t) }, icon('check', 12), t.title)),
        ch.length ? h('button.tg-chip.chores' + (ch.every((c) => c.done) ? '.full' : ''), { onclick: () => choresSheet(d) }, `Ämter ${ch.filter((c) => c.done).length}/${ch.length}`) : null);
    }));

  // Raster
  const cols = days.map((d) => {
    const col = h('div.tg-col' + (d === td ? '.today' : ''), { style: { height: hours.length * HH + 'px' }, onclick: (ev) => {
      if (ev.target !== col) return;
      const y = ev.offsetY; const m = Math.floor((from * 60 + (y / HH) * 60) / 30) * 30;
      openEditor('events', null, { date: d, time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` });
    } });
    const list = timed.filter((e) => e.date === d).map((e) => ({ e, s: minutes(e.time), en: Math.max((minutes(e.endTime) ?? minutes(e.time) + 60), minutes(e.time) + 25) }));
    list.push(...tasks.filter((t) => t.date === d && t.time).map((t) => ({ t, s: minutes(t.time), en: minutes(t.time) + 30 })));
    // Überschneidungen nebeneinander
    list.sort((a, b) => a.s - b.s || b.en - a.en);
    const lanes = [];
    for (const it of list) { let l = lanes.findIndex((end) => end <= it.s); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = it.en; it.lane = l; }
    for (const it of list) { it.n = Math.max(...list.filter((o) => o.s < it.en && o.en > it.s).map((o) => o.lane)) + 1; }
    for (const it of list) {
      const top = ((it.s - from * 60) / 60) * HH; const height = Math.max(26, ((it.en - it.s) / 60) * HH - 4);
      const style = { top: top + 'px', height: height + 'px', left: `calc(${(it.lane / it.n) * 100}% + 3px)`, width: `calc(${100 / it.n}% - 6px)` };
      if (it.t) { col.append(h('button.tg-ev.task', { style, onclick: () => openEditor('tasks', it.t) }, h('b', null, it.t.title), h('small', null, `${fmt.time(it.t.time)} · Aufgabe`))); continue; }
      const e = it.e; const c = colorOf(e);
      const ppl = (e.memberIds || []).map(member).filter(Boolean);
      col.append(h('button.tg-ev' + (height < 48 ? '.short' : ''), { style: { ...style, '--c': c }, onclick: (ev) => detail(e, ev.currentTarget), 'aria-label': `${e.title}, ${fmt.time(e.time)}` },
        h('b', null, e.title), h('small', null, `${fmt.time(e.time)}${e.endTime ? ' – ' + fmt.time(e.endTime) : ''}`),
        height > 74 && ppl.length ? h('span.tg-avs', null, ...ppl.slice(0, 4).map((m) => h('span.av', { style: { '--c': m.color } }, mono(m)))) : null));
    }
    if (d === td) {
      const n = new Date(); const m = n.getHours() * 60 + n.getMinutes();
      if (m >= from * 60 && m <= to * 60) col.append(h('span.tg-now', { style: { top: ((m - from * 60) / 60) * HH + 'px' } }));
    }
    return col;
  });
  const grid = h('div.tg-grid', { style: { '--n': days.length, '--hh': HH + 'px' } },
    h('div.tg-hours', null, ...hours.map((hr) => h('span', { style: { height: HH + 'px' } }, `${hr}:00`))),
    h('div.tg-lines', null, ...hours.map(() => h('i', { style: { height: HH + 'px' } }))), ...cols);
  const scroll = h('div.tg-scroll', null, grid);
  const head = h('div.tg-head', null, strip, allDay);
  // Kopf und Raster gemeinsam seitlich scrollen (Woche auf dem Handy)
  scroll.addEventListener('scroll', () => { head.scrollLeft = scroll.scrollLeft; }, { passive: true });
  head.addEventListener('scroll', () => { if (Math.abs(scroll.scrollLeft - head.scrollLeft) > 1) scroll.scrollLeft = head.scrollLeft; }, { passive: true });
  // Beim ersten Anzeigen: zum frühesten Termin (höchstens bis kurz vor „jetzt“)
  requestAnimationFrame(() => {
    if (scroll.dataset.done) return; scroll.dataset.done = 1;
    const first = mins.length ? Math.floor(Math.min(...mins) / 60) : 8; const n = new Date();
    const target = Math.max(from, Math.min(first, days.includes(td) ? n.getHours() - 1 : first));
    scroll.scrollTop = (target - from) * HH;
  });
  return h('div.tg' + (days.length === 1 ? '.single' : ''), null, head, scroll);
}

// ---------------- Monat ----------------
function monthView(go) {
  const first = cal.cursor;
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const evs = agenda(ymd(start), ymd(addDays(start, 41))).filter(visible);
  const byDay = {};
  for (const e of evs) for (let d = P(e.date); ymd(d) <= (e.endDate || e.date); d = addDays(d, 1)) (byDay[ymd(d)] ||= []).push(e);
  const td = today();
  const taskDays = new Set(hidden().has('tasks') ? [] : openTasks().filter((t) => t.date).map((t) => t.date));
  return h('div.cm-month', null, ...['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => h('span.cm-wd', null, d)),
    ...[...Array(42)].map((_, i) => {
      const d = addDays(start, i); const k = ymd(d); const list = byDay[k] || [];
      return h('button.cm-cell' + (k === td ? '.today' : '') + (k === cal.selected ? '.sel' : '') + (d.getMonth() !== first.getMonth() ? '.out' : ''), { onclick: () => { cal.mode = 'day'; go(k); } },
        h('span.cm-num', null, d.getDate()),
        h('span.cm-evs', null, ...list.slice(0, 3).map((e) => h('i', { style: { '--c': colorOf(e) } }, h('em', null, e.allDay ? '' : fmt.time(e.time) + ' '), e.title)), list.length > 3 ? h('small', null, `+${list.length - 3}`) : null),
        taskDays.has(k) ? h('span.cm-task') : null);
    }));
}

// ---------------- Liste ----------------
function listView() {
  const from = cal.selected < today() ? cal.selected : today();
  const to = ymd(addDays(P(from), 60));
  const groups = {};
  for (const e of agenda(from, to).filter(visible)) (groups[e.date] ||= []).push(eventRow(e));
  if (!hidden().has('tasks')) for (const t of sortTasks(openTasks().filter((x) => x.date && x.date <= to))) (groups[t.date < from ? from : t.date] ||= []).push(taskRow(t, { showDate: t.date < from }));
  const keys = Object.keys(groups).sort();
  return h('div.cm-list', null, keys.length ? keys.map((k) => h('section.section', null, h('h3.section-title', null, fmt.dayLabel(k)), h('div.list', null, ...groups[k]))) : h('p.soft', null, 'In den nächsten Wochen ist nichts geplant.'));
}

// ---------------- Details (Karte wie in der Vorlage) ----------------
function detail(e, anchor) {
  if (e.readOnly) return showExternal(e);
  document.querySelector('.tg-pop')?.remove();
  const ppl = (e.memberIds || []).map(member).filter(Boolean);
  const body = [
    h('div.pop-head', null, h('b', null, e.title), h('button.pop-x', { 'aria-label': 'Schließen', onclick: () => close() }, icon('close', 16))),
    h('div.pop-tags', null, h('span.on', null, e.calName || 'Termin'), e.repeat ? h('span', null, 'Wiederholung') : null, e.remindMin != null ? h('span', null, 'Erinnerung') : null, e.location ? h('span', null, e.location) : null),
    h('div.pop-row', null, icon('clock', 16), h('span', null, fmt.dayLabel(e.date)), h('span', null, e.allDay ? 'ganztägig' : `${fmt.time(e.time)}${e.endTime ? ' – ' + fmt.time(e.endTime) : ''} Uhr`)),
    h('div.pop-row', null, icon('users', 16), h('span.muted', null, ppl.length ? 'Dabei' : 'Für die ganze Familie')),
    ...ppl.map((m) => h('div.pop-person', null, h('span.av', { style: { '--c': m.color } }, mono(m)), h('span', null, m.name))),
    e.notes ? h('p.pop-notes', null, e.notes) : null,
    h('button.btn.primary.small', { onclick: () => { close(); openEditor('events', e); } }, icon('edit', 16), 'Bearbeiten')];
  if (innerWidth < 720 || !anchor) { sheet((s) => h('div.sheet-body.pop-sheet', null, ...body.map((x) => x)), { label: e.title }); return; }
  const pop = h('div.tg-pop', { role: 'dialog', 'aria-label': e.title }, ...body);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect(); const w = 280;
  let left = r.right + 10; if (left + w > innerWidth - 10) left = Math.max(10, r.left - w - 10);
  const top = Math.min(Math.max(10, r.top), innerHeight - pop.offsetHeight - 10);
  Object.assign(pop.style, { left: left + 'px', top: top + 'px' });
  const away = (ev) => { if (!pop.contains(ev.target)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', away), 0);
  function close() { pop.remove(); document.removeEventListener('pointerdown', away); }
  haptic();
}

function choresSheet(d) {
  sheet(() => {
    const box = h('div.sheet-body', null);
    const draw = () => box.replaceChildren(h('h2.sheet-title', null, `Ämter · ${fmt.dayLabel(d)}`),
      h('div.chore-chips', null, ...choresFor(d, childMode()?.id).map((it) => { const m = member(it.memberId); return h('button.chore-chip' + (it.done ? '.done' : ''), { style: { '--c': m.color }, disabled: d > today(), onclick: (ev) => { toggleChore(it.chore, m.id, d, ev.currentTarget); setTimeout(draw, 50); } }, h('span.av', { style: { '--c': m.color } }, it.done ? icon('check', 14) : mono(m)), h('span.cc-emo', null, it.chore.emoji || '⭐'), h('span', null, it.chore.title), h('small', null, `+${it.chore.points || 1}`)); })),
      h('a.btn.ghost.more-btn', { href: '#plan' }, icon('list-checks', 18), 'Wochenplan öffnen'));
    draw(); return box;
  }, { label: 'Ämter' });
}
