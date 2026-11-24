// Hauptbereiche: Heute, Kalender, Aufgaben, Einkauf.
import { h, icon, fmt, toast, mono } from './ui.js';
import { store } from './store.js';
import { agenda, openTasks, doneTasks, taskBucket, BUCKETS, sortTasks, completeTask, reopenTask, members, member, childMode, refreshNative, today } from './domain.js';
import { ymd, addDays, repeatLabel, parse } from './nlp.js';
import { openEditor } from './editors.js';
import { openCapture, commit } from './capture.js';
import { haptic } from './native.js';
import { minutesOf } from './recur.js';
import { choresFor, toggleChore } from './household.js';
import { celebrate } from './fx.js';
import { viewDashboard } from './dashboard.js';
import { sheet } from './ui.js';

export const TASK_TABS = [['aufgaben', 'To-dos'], ['aemter', 'Ämter'], ['plan', 'Wochenplan'], ['routinen', 'Routinen'], ['sterne', 'Sterne']];
export const KITCHEN_TABS = [['einkauf', 'Einkauf'], ['essen', 'Essensplan'], ['rezepte', 'Rezepte'], ['coach', 'Coach']];
export function subnav(tabs, active) {
  return h('nav.subnav', { 'aria-label': 'Bereich' }, ...tabs.map(([k, l]) => h('a.sub' + (k === active ? '.on' : ''), { href: '#' + k, 'aria-current': k === active ? 'page' : null }, l)));
}
export function hubPage(title, tabs, active, content) {
  return h('div.page', null, h('div.page-head', null, h('h1', null, title)), subnav(tabs, active), content);
}

export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}

export function showExternal(ev) {
  sheet(() => h('div.sheet-body', null,
    h('h2.sheet-title', null, ev.title),
    h('p.muted', null, `${fmt.dayLabel(ev.date)}${ev.allDay ? ', ganztägig' : ', ' + fmt.time(ev.time) + (ev.endTime ? '–' + fmt.time(ev.endTime) : '') + ' Uhr'}`),
    ev.location ? h('p', null, '📍 ', ev.location) : null,
    ev.notes ? h('p.prewrap.muted', null, ev.notes) : null,
    h('p.hint', null, `Aus dem verbundenen Kalender „${ev.calName || 'Extern'}“. Ändern bitte dort – FamilyHub zeigt ihn nur an.`)), { label: ev.title });
}

// ---------- gemeinsame Bausteine ----------
export function avatars(ids, size = 'sm') {
  const ms = (ids || []).map(member).filter(Boolean);
  if (!ms.length) return null;
  return h('span.avs.' + size, null, ...ms.slice(0, 4).map((m) => h('span.av', { style: { '--c': m.color }, title: m.name }, mono(m))));
}

export function eventRow(ev, { showDay } = {}) {
  const c = ev.calColor || (ev.memberIds?.length ? member(ev.memberIds[0])?.color : null);
  const now = new Date(); const td = ymd(now); const nowMin = now.getHours() * 60 + now.getMinutes();
  const past = ev.date < td || (ev.date === td && !ev.allDay && (minutesOf(ev.endTime || ev.time) ?? 0) < nowMin);
  return h('button.item.event' + (past ? '.past' : ''), { style: { '--c': c || 'var(--primary)' }, onclick: () => (ev.readOnly ? showExternal(ev) : openEditor('events', ev)) },
    h('div.when', null, ev.allDay ? h('span.allday', null, 'ganzt.') : [h('b', null, fmt.time(ev.time)), ev.endTime ? h('span', null, fmt.time(ev.endTime)) : null]),
    h('div.bar'),
    h('div.what', null,
      h('div.title', null, ev.title),
      h('div.meta', null,
        showDay ? h('span', null, fmt.dayLabel(ev.date)) : null,
        ev.calName ? h('span', null, icon('link', 13), ev.calName) : null,
        ev.location ? h('span', null, icon('pin', 13), ev.location) : null,
        ev.repeat ? h('span', null, icon('repeat', 13), repeatLabel(ev.repeat)) : null,
        ev.remindMin != null && ev.time ? h('span', { 'aria-label': 'Erinnerung' }, icon('bell', 13)) : null)),
    avatars(ev.memberIds));
}

export function taskRow(t, { showDate = true } = {}) {
  const bucket = taskBucket(t);
  const check = h('button.check' + (t.done ? '.on' : ''), { 'aria-label': t.done ? 'Als offen markieren' : 'Erledigt', onclick: (e) => {
    e.stopPropagation();
    haptic('success');
    if (t.done) { reopenTask(t); return; }
    row.classList.add('completing');
    const rect = check.getBoundingClientRect();
    setTimeout(() => {
      const r = completeTask(t);
      if (r.earned.length) { r.earned.forEach((x) => celebrate(x.memberId, x.pts, t.title, rect)); refreshNative(); return; }
      refreshNative();
      toast(r.next ? `Erledigt · nächstes Mal ${fmt.dayLabel(r.next)}` : 'Erledigt 🎉', { label: 'Rückgängig', run: () => { r.undo(); refreshNative(); } });
    }, 280);
  } }, icon('check', 16));
  const row = h('div.item.task' + (t.done ? '.done' : '') + (t.priority ? '.prio' : ''), { role: 'button', tabindex: 0, onclick: () => openEditor('tasks', t) },
    check,
    h('div.what', null,
      h('div.title', null, t.title),
      h('div.meta', null,
        showDate && t.date ? h('span' + (bucket === 'overdue' && !t.done ? '.warn' : ''), null, icon('calendar', 13), fmt.dayLabel(t.date) + (t.time ? ', ' + fmt.time(t.time) : '')) : null,
        t.repeat ? h('span', null, icon('repeat', 13), repeatLabel(t.repeat)) : null,
        t.priority ? h('span.warn', null, icon('flag', 13), 'wichtig') : null,
        t.streak > 1 ? h('span', null, `🔥 ${t.streak}×`) : null,
        t.points > 0 ? h('span.pts', null, `+${t.points} ⭐`) : null)),
    avatars(t.memberIds));
  return row;
}

// ---------- Ämter im Kalender ----------
function choreSummary(date) {
  const by = {};
  for (const it of choresFor(date)) { const x = (by[it.memberId] ||= { m: member(it.memberId), done: 0, total: 0 }); x.total++; if (it.done) x.done++; }
  return Object.values(by).filter((x) => x.m && (!childMode() || x.m.id === childMode().id));
}
function choreMeter(date) {
  const s = choreSummary(date); const total = s.reduce((a, x) => a + x.total, 0);
  if (!total) return null;
  const done = s.reduce((a, x) => a + x.done, 0);
  return h('span.day-ch' + (done === total ? '.full' : '') + (date > today() ? '.future' : ''), { style: { '--p': done / total }, title: `Ämter ${done}/${total}` });
}
function dayChores(date) {
  const kid = childMode();
  const list = choresFor(date, kid?.id);
  if (!list.length) return null;
  const can = date <= today();
  return h('div.day-chores', null,
    h('div.section-head', null, h('h3.section-title', null, 'Ämter', h('span.count-pill', null, `${list.filter((x) => x.done).length}/${list.length}`)), h('a.link', { href: '#plan' }, 'Wochenplan')),
    h('div.chore-chips', null, ...list.map((it) => { const m = member(it.memberId); return h('button.chore-chip' + (it.done ? '.done' : ''), { style: { '--c': m.color }, disabled: !can, onclick: (e) => toggleChore(it.chore, m.id, date, e.currentTarget) },
      h('span.av', { style: { '--c': m.color } }, it.done ? icon('check', 14) : mono(m)), h('span.cc-emo', null, it.chore.emoji || '⭐'), h('span', null, it.chore.title), h('small', null, `+${it.chore.points || 1}`)); })));
}

function section(title, ...children) { return h('section.section', null, title ? h('h3.section-title', null, title) : null, ...children); }
function empty(ic, text, action) { return h('div.empty', null, icon(ic, 36), h('p', null, text), action || null); }

export function personFilter() {
  if (childMode()) return null;
  const ms = members();
  if (ms.length < 2) return null;
  const cur = store.config.filterMember;
  return h('div.filter', { role: 'tablist', 'aria-label': 'Person filtern' },
    h('button.fchip' + (!cur ? '.on' : ''), { onclick: () => store.saveConfig({ filterMember: null }) }, 'Alle'),
    ...ms.map((m) => h('button.fchip' + (cur === m.id ? '.on' : ''), { style: { '--c': m.color }, onclick: () => store.saveConfig({ filterMember: cur === m.id ? null : m.id }) }, h('span.dot'), m.name)));
}

// ---------- Heute ----------
export function viewToday() { return viewDashboard(); }

// ---------- Kalender (neu in calendar.js: Seitenleiste, Zeitraster, Monat/Woche/Tag/Liste) ----------
export { viewCalendar } from './calendar.js';

// ---------- Aufgaben ----------
const tv = { show: 'open' };
export function viewTasks() {
  const page = h('div.page.tasks');
  const rerender = () => page.replaceWith(viewTasks());
  let input;
  const add = h('form.addbar', { onsubmit: (e) => {
    e.preventDefault();
    const txt = input.value.trim(); if (!txt) return;
    const p = parse(txt, { members: members(), meId: store.config.meId });
    if (p.kind !== 'task') p.kind = 'task';
    if (childMode() && !p.memberIds.length) p.memberIds = [childMode().id];
    commit(p); input.value = ''; haptic('success');
    toast('Aufgabe gespeichert');
  } },
  input = h('input', { placeholder: 'Neue Aufgabe, z. B. „Freitag Rasen mähen“', enterkeyhint: 'done', 'aria-label': 'Neue Aufgabe' }),
  h('button.icon-btn.mic', { type: 'button', 'aria-label': 'Per Sprache', onclick: () => openCapture({ mode: 'voice', kind: 'task' }) }, icon('mic')),
  h('button.icon-btn.primary', { type: 'submit', 'aria-label': 'Hinzufügen' }, icon('plus')));

  const seg = h('div.seg', null,
    h('button.seg-btn' + (tv.show === 'open' ? '.on' : ''), { onclick: () => { tv.show = 'open'; rerender(); } }, 'Offen'),
    h('button.seg-btn' + (tv.show === 'done' ? '.on' : ''), { onclick: () => { tv.show = 'done'; rerender(); } }, 'Erledigt'));

  page.append(h('div.page-head', null, h('h1', null, 'Aufgaben'), seg), subnav(TASK_TABS, 'aufgaben'), add, personFilter() || '');

  if (tv.show === 'open') {
    const list = sortTasks(openTasks());
    if (!list.length) page.append(empty('check', 'Alles erledigt! Zeit für eine Pause. ☕'));
    for (const [key, label] of BUCKETS) {
      const items = list.filter((t) => taskBucket(t) === key);
      if (items.length) page.append(section([label, h('span.count-pill', null, items.length)], h('div.list', null, ...items.map((t) => taskRow(t, { showDate: key !== 'today' && key !== 'tomorrow' })))));
    }
  } else {
    const list = doneTasks().slice(0, 100);
    page.append(list.length ? h('div.list', null, ...list.map((t) => taskRow(t))) : empty('tasks', 'Noch nichts erledigt.'));
    if (list.length && !childMode()) page.append(h('button.btn.ghost.more-btn', { onclick: () => { const old = doneTasks(); old.forEach((t) => store.del('tasks', t.id)); toast(`${old.length} erledigte Aufgaben entfernt`, { label: 'Rückgängig', run: () => store.putMany('tasks', old) }); } }, icon('trash', 18), 'Erledigte aufräumen'));
  }
  return page;
}

// ---------- Einkauf ----------
// (neu in shopping.js: Läden, Bildkacheln, wiederkehrende Einkäufe, Prospekte)
export { viewShopping } from './shopping.js';
