// Fachlogik: was steht wann an, wer ist beteiligt, was ist fällig.
import { store } from './store.js';
import { occurrences, nextDate, minutesOf } from './recur.js';
import { ymd, addDays } from './nlp.js';
import { scheduleReminders, updateWidget } from './native.js';
import { externalEvents } from './extcal.js';

export const MEMBER_COLORS = ['#E4572E', '#2E86AB', '#7A9E3B', '#9B5DE5', '#F2A541', '#17A398', '#D64A8A', '#5C6B7A'];
export const MEMBER_EMOJI = ['🦊', '🐻', '🐼', '🦁', '🐯', '🐨', '🐸', '🐙', '🦄', '🐝', '🐳', '🌻', '⚽', '🎸', '🚀', '⭐'];

export function members() { return store.list('members').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)); }
export function member(id) { return store.get('members', id); }
export function memberColor(id) { return member(id)?.color || 'var(--muted)'; }

export function childMode() { const c = store.config.child; return c.activeMemberId && member(c.activeMemberId) ? member(c.activeMemberId) : null; }

/** Personenfilter (global oder Kindermodus) */
export function activeFilter() { return childMode()?.id || store.config.filterMember || null; }
function matchesFilter(item, f = activeFilter()) { return !f || !item.memberIds?.length || item.memberIds.includes(f); }

export function today() { return ymd(new Date()); }

/** Termine (inkl. Serien) zwischen from und to, sortiert. */
export function agenda(from, to, { filter = true } = {}) {
  const f = filter ? activeFilter() : null;
  const out = [];
  for (const ev of [...store.list('events'), ...externalEvents()]) {
    if (!matchesFilter(ev, f)) continue;
    out.push(...occurrences(ev, from, to));
  }
  return out.sort(byDateTime);
}
export function byDateTime(a, b) {
  return a.date.localeCompare(b.date) || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title);
}

export function openTasks({ filter = true } = {}) {
  const f = filter ? activeFilter() : null;
  return store.list('tasks').filter((t) => !t.done && matchesFilter(t, f));
}
export function doneTasks({ filter = true } = {}) {
  const f = filter ? activeFilter() : null;
  return store.list('tasks').filter((t) => t.done && matchesFilter(t, f)).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
}

export function taskBucket(t, now = new Date()) {
  if (!t.date) return 'none';
  const td = ymd(now);
  if (t.date < td) return 'overdue';
  if (t.date === td) return 'today';
  if (t.date === ymd(addDays(now, 1))) return 'tomorrow';
  if (t.date <= ymd(addDays(now, 7))) return 'week';
  return 'later';
}
export const BUCKETS = [['overdue', 'Überfällig'], ['today', 'Heute'], ['tomorrow', 'Morgen'], ['week', 'Nächste 7 Tage'], ['later', 'Später'], ['none', 'Ohne Datum']];

export function sortTasks(list) {
  return [...list].sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '99').localeCompare(b.time || '99') || (a.createdAt || 0) - (b.createdAt || 0));
}

/** Aufgabe abhaken. Bei Wiederholung wird sie aufs nächste Datum verschoben. Gibt Undo-Funktion zurück. */
export function completeTask(t) {
  const before = { ...t };
  if (t.repeat && t.date) {
    let next = nextDate(t.date, t.repeat);
    const td = today();
    while (next && next < td) next = nextDate(next, t.repeat);
    store.put('tasks', { ...t, date: next, lastDoneAt: Date.now(), lastDoneBy: store.config.meId || null, streak: (t.streak || 0) + 1 });
    return { next, undo: () => store.put('tasks', before) };
  }
  store.put('tasks', { ...t, done: true, doneAt: Date.now(), doneBy: store.config.meId || null });
  return { undo: () => store.put('tasks', { ...before, done: false }) };
}

/** Termin löschen – bei Serien nur ein Vorkommen oder alle. */
export function deleteEvent(ev, mode = 'all') {
  const base = store.get('events', ev.id);
  if (!base) return null;
  if (mode === 'one' && base.repeat) {
    store.put('events', { ...base, exdates: [...(base.exdates || []), ev.occurrence || ev.date] });
    return () => store.put('events', base);
  }
  store.del('events', ev.id);
  return () => store.put('events', base);
}

export function nextUp(now = new Date()) {
  const td = ymd(now); const nowMin = now.getHours() * 60 + now.getMinutes();
  const list = agenda(td, ymd(addDays(now, 14))).filter((e) => !e.allDay && e.time && (e.date > td || (minutesOf(e.endTime || e.time) ?? 0) >= nowMin));
  return list[0] || null;
}

// ---------- Erinnerungen & Widget (nur in der App) ----------
export function refreshNative() {
  clearTimeout(refreshNative.t);
  refreshNative.t = setTimeout(() => {
    const now = new Date();
    const horizon = ymd(addDays(now, 30));
    const items = [];
    const child = childMode();
    const me = store.config.meId;
    const mine = (x) => !me || !x.memberIds?.length || x.memberIds.includes(me);
    if (!child) {
      for (const ev of agenda(ymd(now), horizon, { filter: false })) {
        if (ev.remindMin == null || !ev.time || !mine(ev)) continue;
        const at = toDate(ev.date, ev.time).getTime() - ev.remindMin * 60000;
        if (at > now.getTime()) items.push({ key: `e:${ev.id}:${ev.date}`, at, title: ev.title, body: `${ev.remindMin ? 'Um ' + ev.time.replace(/^0/, '') + ' Uhr' : 'Jetzt'}${ev.location ? ' · ' + ev.location : ''}` });
      }
      for (const t of openTasks({ filter: false })) {
        if (t.remindMin == null || !t.date || !mine(t)) continue;
        const at = toDate(t.date, t.time || '09:00').getTime() - (t.remindMin || 0) * 60000;
        if (at > now.getTime()) items.push({ key: `t:${t.id}:${t.date}`, at, title: '☑ ' + t.title, body: 'Aufgabe fällig' });
      }
    }
    items.sort((a, b) => a.at - b.at);
    scheduleReminders(items.slice(0, 120));

    const td = ymd(now);
    const todayEvents = agenda(td, td, { filter: false });
    const open = openTasks({ filter: false });
    const due = open.filter((t) => t.date && t.date <= td);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const upcoming = todayEvents.filter((e) => e.allDay || (minutesOf(e.endTime || e.time) ?? 0) >= nowMin).slice(0, 4)
      .map((e) => (e.allDay ? 'Ganztägig · ' : e.time.replace(/^0/, '') + ' · ') + e.title);
    if (upcoming.length < 3) {
      const tomorrow = ymd(addDays(now, 1));
      for (const e of agenda(tomorrow, tomorrow, { filter: false }).slice(0, 3 - upcoming.length)) upcoming.push('Morgen ' + (e.allDay ? '' : e.time.replace(/^0/, '') + ' · ') + e.title);
    }
    updateWidget({
      events: todayEvents.length, tasks: due.length, openTasks: open.length,
      shopping: store.list('shopping').filter((s) => !s.done).length,
      lines: upcoming, tasksPreview: sortTasks(due).slice(0, 3).map((t) => t.title),
      child: !!child, updated: Date.now(),
    });
  }, 500);
}
export function toDate(dateStr, time) { const [y, m, d] = dateStr.split('-').map(Number); const [hh, mm] = (time || '00:00').split(':').map(Number); return new Date(y, m - 1, d, hh, mm); }
