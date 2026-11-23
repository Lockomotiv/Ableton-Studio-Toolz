// Hauptbereiche: Heute, Kalender, Aufgaben, Einkauf.
import { h, icon, fmt, toast } from './ui.js';
import { store } from './store.js';
import { agenda, openTasks, doneTasks, taskBucket, BUCKETS, sortTasks, completeTask, nextUp, members, member, childMode, refreshNative, today } from './domain.js';
import { ymd, addDays, repeatLabel, SHOPPING_CATEGORY_ORDER, shoppingCategory, parse } from './nlp.js';
import { openEditor } from './editors.js';
import { openCapture, commit } from './capture.js';
import { haptic } from './native.js';
import { minutesOf } from './recur.js';
import { todayKidsCard } from './household.js';
import { todayMealsCard } from './kitchen.js';
import { sheet } from './ui.js';

export const TASK_TABS = [['aufgaben', 'To-dos'], ['aemter', 'Ämter'], ['routinen', 'Routinen'], ['sterne', 'Sterne']];
export const KITCHEN_TABS = [['einkauf', 'Einkauf'], ['essen', 'Essensplan'], ['rezepte', 'Rezepte']];
export function subnav(tabs, active) {
  return h('nav.subnav', { 'aria-label': 'Bereich' }, ...tabs.map(([k, l]) => h('a.sub' + (k === active ? '.on' : ''), { href: '#' + k, 'aria-current': k === active ? 'page' : null }, l)));
}
export function hubPage(title, tabs, active, content) {
  return h('div.page', null, h('div.page-head', null, h('h1', null, title)), subnav(tabs, active), content);
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}

function showExternal(ev) {
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
  return h('span.avs.' + size, null, ...ms.slice(0, 4).map((m) => h('span.av', { style: { '--c': m.color }, title: m.name }, m.emoji || m.name[0])));
}

function eventRow(ev, { showDay } = {}) {
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

function taskRow(t, { showDate = true } = {}) {
  const bucket = taskBucket(t);
  const check = h('button.check' + (t.done ? '.on' : ''), { 'aria-label': t.done ? 'Als offen markieren' : 'Erledigt', onclick: (e) => {
    e.stopPropagation();
    haptic('success');
    if (t.done) { store.put('tasks', { ...t, done: false, doneAt: null }); return; }
    row.classList.add('completing');
    setTimeout(() => {
      const r = completeTask(t);
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
        t.streak > 1 ? h('span', null, `🔥 ${t.streak}×`) : null)),
    avatars(t.memberIds));
  return row;
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
export function viewToday() {
  const now = new Date(); const td = today(); const tm = ymd(addDays(now, 1));
  const hour = now.getHours();
  const greet = hour < 5 ? 'Gute Nacht' : hour < 11 ? 'Guten Morgen' : hour < 17 ? 'Hallo' : hour < 22 ? 'Guten Abend' : 'Gute Nacht';
  const kid = childMode();
  const me = kid || member(store.config.meId);
  const todays = agenda(td, td);
  const tomorrows = agenda(tm, tm);
  const tasks = sortTasks(openTasks());
  const dueTasks = tasks.filter((t) => t.date && t.date <= td);
  const nxt = nextUp(now);
  const shop = store.list('shopping').filter((s) => !s.done);

  const quick = h('button.quickbar', { onclick: () => openCapture({ mode: 'text' }) },
    icon('sparkle', 20), h('span.qtext', null, 'Was steht an?'),
    h('span.quick-mic', { onclick: (e) => { e.stopPropagation(); openCapture({ mode: 'voice' }); } }, icon('mic', 20)));

  const hero = nxt ? h('button.hero', { style: { '--c': nxt.memberIds?.length ? member(nxt.memberIds[0])?.color : 'var(--primary)' }, onclick: () => openEditor('events', nxt) },
    h('div.hero-label', null, 'Als Nächstes · ' + fmt.until(nxt.date, nxt.time, now)),
    h('div.hero-title', null, nxt.title),
    h('div.hero-meta', null, `${fmt.dayLabel(nxt.date)}, ${fmt.time(nxt.time)}${nxt.endTime ? '–' + fmt.time(nxt.endTime) : ''} Uhr`, nxt.location ? ' · ' + nxt.location : ''),
    avatars(nxt.memberIds, 'md')) : null;

  const stats = h('div.stats', null,
    h('a.stat', { href: '#kalender' }, h('b', null, todays.length), h('span', null, todays.length === 1 ? 'Termin heute' : 'Termine heute')),
    h('a.stat', { href: '#aufgaben' }, h('b', null, dueTasks.length), h('span', null, 'Aufgaben fällig')),
    !kid ? h('a.stat', { href: '#einkauf' }, h('b', null, shop.length), h('span', null, 'auf der Liste')) : null);

  return h('div.page.today', null,
    h('header.greet', null,
      h('p.date', null, fmt.longDate(now)),
      h('h1', null, `${greet}${me ? ', ' + me.name : ''}`, kid ? ' ' + (kid.emoji || '👋') : '')),
    quick,
    personFilter(),
    stats,
    hero,
    section('Heute',
      todays.length ? h('div.list', null, ...todays.map((e) => eventRow(e))) : h('p.soft', null, 'Heute keine Termine. 🌤'),
    ),
    dueTasks.length ? section('Zu erledigen', h('div.list', null, ...dueTasks.slice(0, 6).map((t) => taskRow(t))), dueTasks.length > 6 ? h('a.more', { href: '#aufgaben' }, `Alle ${dueTasks.length} anzeigen`) : null) : null,
    todayKidsCard(),
    todayMealsCard(),
    tomorrows.length ? section('Morgen', h('div.list', null, ...tomorrows.map((e) => eventRow(e)))) : null,
    !kid && shop.length ? section('Einkaufsliste', h('a.card.shop-teaser', { href: '#einkauf' },
      h('div.pills', null, ...shop.slice(0, 8).map((s) => h('span.pill', null, s.name)), shop.length > 8 ? h('span.pill.more', null, '+' + (shop.length - 8)) : null))) : null,
    !members().length && !kid ? h('div.card.tip', null, h('b', null, 'Tipp: Familie anlegen'), h('p', null, 'Leg alle Familienmitglieder an. Dann versteht FamilyHub Sätze wie „Freitag Turnen mit Lena“ und färbt alles passend ein.'), h('a.btn.tonal', { href: '#familie' }, icon('users', 18), 'Familie einrichten')) : null,
  );
}

// ---------- Kalender ----------
const cal = { mode: 'month', cursor: null, selected: null };
export function viewCalendar() {
  const now = new Date();
  if (!cal.selected) cal.selected = today();
  if (!cal.cursor) cal.cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  const page = h('div.page.calendar');
  const rerender = () => page.replaceWith(viewCalendar());

  const week = cal.mode === 'week';
  const wkStart = ymd(addDays(fmt.parse(cal.selected), -((fmt.parse(cal.selected).getDay() + 6) % 7)));
  const shift = (dir) => {
    if (week) { cal.selected = ymd(addDays(fmt.parse(cal.selected), 7 * dir)); const d = fmt.parse(cal.selected); cal.cursor = new Date(d.getFullYear(), d.getMonth(), 1); }
    else cal.cursor = new Date(cal.cursor.getFullYear(), cal.cursor.getMonth() + dir, 1);
    rerender();
  };
  const head = h('div.cal-head', null,
    week ? h('h2', null, `KW ${isoWeek(fmt.parse(wkStart))} `, h('span.year', null, `${fmt.parse(wkStart).getDate()}.${fmt.parse(wkStart).getMonth() + 1}.`))
      : h('h2', null, `${fmt.MO[cal.cursor.getMonth()]} `, h('span.year', null, cal.cursor.getFullYear())),
    h('button.icon-btn', { 'aria-label': week ? 'Vorige Woche' : 'Voriger Monat', onclick: () => shift(-1) }, icon('left')),
    h('button.icon-btn', { 'aria-label': week ? 'Nächste Woche' : 'Nächster Monat', onclick: () => shift(1) }, icon('right')),
    h('button.btn.small.tonal', { onclick: () => { cal.cursor = new Date(now.getFullYear(), now.getMonth(), 1); cal.selected = today(); rerender(); } }, 'Heute'),
    h('div.seg.small', null,
      h('button.seg-btn' + (cal.mode === 'month' ? '.on' : ''), { 'aria-label': 'Monat', onclick: () => { cal.mode = 'month'; rerender(); } }, icon('grid', 18)),
      h('button.seg-btn' + (cal.mode === 'week' ? '.on' : ''), { 'aria-label': 'Woche', onclick: () => { cal.mode = 'week'; rerender(); } }, icon('calendar', 18)),
      h('button.seg-btn' + (cal.mode === 'list' ? '.on' : ''), { 'aria-label': 'Liste', onclick: () => { cal.mode = 'list'; rerender(); } }, icon('list', 18))));

  page.append(head, personFilter() || '');

  if (week) {
    const days = [...Array(7)].map((_, i) => ymd(addDays(fmt.parse(wkStart), i)));
    const evs = agenda(days[0], days[6]);
    const tasks = openTasks().filter((t) => t.date >= days[0] && t.date <= days[6]);
    page.append(h('div.week', null, ...days.map((d) => {
      const dt = fmt.parse(d);
      const dayEv = evs.filter((e) => e.date <= d && (e.endDate || e.date) >= d);
      const dayT = sortTasks(tasks.filter((t) => t.date === d));
      return h('div.week-day' + (d === today() ? '.today' : ''), null,
        h('button.wd-head', { onclick: () => openCapture({ mode: 'text', kind: 'event', date: d }), 'aria-label': 'Termin am ' + fmt.longDate(dt) }, h('span', null, fmt.WD[dt.getDay()]), h('b', null, dt.getDate()), icon('plus', 14)),
        h('div.wd-items', null,
          ...dayEv.map((e) => h('button.wchip', { style: { '--c': e.calColor || (e.memberIds?.length ? member(e.memberIds[0])?.color : 'var(--primary)') }, onclick: () => (e.readOnly ? showExternal(e) : openEditor('events', e)) }, e.allDay ? '' : h('b', null, fmt.time(e.time) + ' '), e.title)),
          ...dayT.map((t) => h('button.wchip.task', { onclick: () => openEditor('tasks', t) }, '☐ ', t.title)),
          !dayEv.length && !dayT.length ? h('span.wd-free', null, 'frei') : null));
    })));
  } else if (cal.mode === 'month') {
    const first = cal.cursor;
    const startOffset = (first.getDay() + 6) % 7; // Montag zuerst
    const gridStart = addDays(first, -startOffset);
    const gridEnd = addDays(gridStart, 41);
    const evs = agenda(ymd(gridStart), ymd(gridEnd));
    const tasks = openTasks().filter((t) => t.date);
    const byDay = {};
    for (const e of evs) {
      if (e.endDate && e.endDate > e.date) {
        for (let d = new Date(+new Date(e.date.replace(/-/g, '/'))); ymd(d) <= e.endDate; d = addDays(d, 1)) (byDay[ymd(d)] ||= []).push(e);
      } else (byDay[e.date] ||= []).push(e);
    }
    const taskDays = new Set(tasks.map((t) => t.date));
    const grid = h('div.month', { role: 'grid' }, ...['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => h('div.wd', null, d)));
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i); const key = ymd(d);
      const list = byDay[key] || [];
      const cls = ['day', d.getMonth() !== first.getMonth() ? 'out' : '', key === today() ? 'today' : '', key === cal.selected ? 'sel' : '', d.getDay() === 0 || d.getDay() === 6 ? 'we' : ''].filter(Boolean).join('.');
      grid.append(h('button.' + cls, { onclick: () => { haptic(); cal.selected = key; rerender(); }, 'aria-label': fmt.longDate(d) + (list.length ? `, ${list.length} Termine` : '') },
        h('span.num', null, d.getDate()),
        h('span.dots', null, ...list.slice(0, 3).map((e) => h('i', { style: { background: e.calColor || (e.memberIds?.length ? member(e.memberIds[0])?.color : 'var(--primary)') } })), list.length > 3 ? h('i.plus') : null, taskDays.has(key) ? h('i.task') : null)));
    }
    page.append(grid);
    const sel = cal.selected;
    const dayEvents = agenda(sel, sel);
    const dayTasks = sortTasks(openTasks().filter((t) => t.date === sel));
    page.append(section(fmt.longDate(fmt.parse(sel)),
      dayEvents.length || dayTasks.length ? h('div.list', null, ...dayEvents.map((e) => eventRow(e)), ...dayTasks.map((t) => taskRow(t, { showDate: false }))) : h('p.soft', null, 'Nichts geplant.'),
      h('button.btn.tonal.add-here', { onclick: () => openCapture({ mode: 'text', kind: 'event', date: sel }) }, icon('plus', 18), 'Termin an diesem Tag')));
  } else {
    const from = today();
    const to = ymd(addDays(new Date(), cal.listDays || 60));
    const evs = agenda(from, to);
    const groups = {};
    for (const e of evs) (groups[e.date] ||= []).push(e);
    const keys = Object.keys(groups);
    page.append(keys.length ? h('div', null, ...keys.map((k) => section(fmt.dayLabel(k) + (fmt.dayDiff(k) < 7 && fmt.dayDiff(k) > 1 ? '' : ''), h('div.list', null, ...groups[k].map((e) => eventRow(e)))))) : empty('calendar', 'In den nächsten Wochen ist nichts geplant.'),
      h('button.btn.ghost.more-btn', { onclick: () => { cal.listDays = (cal.listDays || 60) + 90; rerender(); } }, 'Weitere Termine laden'));
  }
  return page;
}

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
      if (items.length) page.append(section(label + ` · ${items.length}`, h('div.list', null, ...items.map((t) => taskRow(t, { showDate: key !== 'today' && key !== 'tomorrow' })))));
    }
  } else {
    const list = doneTasks().slice(0, 100);
    page.append(list.length ? h('div.list', null, ...list.map((t) => taskRow(t))) : empty('tasks', 'Noch nichts erledigt.'));
    if (list.length && !childMode()) page.append(h('button.btn.ghost.more-btn', { onclick: () => { const old = doneTasks(); old.forEach((t) => store.del('tasks', t.id)); toast(`${old.length} erledigte Aufgaben entfernt`, { label: 'Rückgängig', run: () => store.putMany('tasks', old) }); } }, icon('trash', 18), 'Erledigte aufräumen'));
  }
  return page;
}

// ---------- Einkauf ----------
export function viewShopping() {
  const page = h('div.page.shopping');
  let input;
  const all = store.list('shopping');
  const open = all.filter((s) => !s.done);
  const done = all.filter((s) => s.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const addItems = (txt) => {
    const p = parse(/einkauf|kauf|brauch|besorg/i.test(txt) ? txt : 'Kaufe ' + txt, { members: members() });
    const items = p.items.length ? p.items : [{ name: txt, category: shoppingCategory(txt) }];
    const existing = new Map(all.map((s) => [s.name.toLowerCase(), s]));
    const fresh = [];
    for (const it of items) {
      const ex = existing.get(it.name.toLowerCase());
      if (ex && ex.done) store.put('shopping', { ...ex, done: false, doneAt: null });
      else if (!ex) fresh.push({ name: it.name, category: it.category, done: false, addedBy: store.config.meId });
    }
    if (fresh.length) store.putMany('shopping', fresh);
    haptic('success');
  };
  const add = h('form.addbar', { onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; addItems(t); input.value = ''; input.focus(); } },
    input = h('input', { placeholder: 'Artikel hinzufügen – mehrere mit Komma', enterkeyhint: 'enter', 'aria-label': 'Artikel' }),
    h('button.icon-btn.mic', { type: 'button', 'aria-label': 'Per Sprache', onclick: () => openCapture({ mode: 'voice', kind: 'shopping' }) }, icon('mic')),
    h('button.icon-btn.primary', { type: 'submit', 'aria-label': 'Hinzufügen' }, icon('plus')));

  page.append(h('div.page-head', null, h('h1', null, 'Einkauf'), h('span.count', null, open.length ? `${open.length} offen` : '')), subnav(KITCHEN_TABS, 'einkauf'), add);

  // Schnell wieder hinzufügen: zuletzt gekaufte Artikel
  const recent = done.filter((d, i, arr) => arr.findIndex((x) => x.name.toLowerCase() === d.name.toLowerCase()) === i).slice(0, 10);
  if (recent.length) page.append(h('div.recent', null, h('span.muted', null, 'Nochmal:'), ...recent.map((r) => h('button.pill.add', { onclick: () => { store.put('shopping', { ...r, done: false, doneAt: null }); haptic(); } }, '+ ' + r.name))));

  if (!open.length) page.append(empty('cart', 'Die Einkaufsliste ist leer.'));
  const byCat = {};
  for (const s of open) (byCat[s.category || 'Sonstiges'] ||= []).push(s);
  for (const cat of SHOPPING_CATEGORY_ORDER) {
    const items = byCat[cat]; if (!items) continue;
    page.append(section(cat, h('div.list.compact', null, ...items.sort((a, b) => a.name.localeCompare(b.name)).map((s) => shopRow(s)))));
  }
  if (done.length) {
    page.append(section(`Im Wagen · ${done.length}`, h('div.list.compact', null, ...done.slice(0, 30).map((s) => shopRow(s)))),
      h('button.btn.ghost.more-btn', { onclick: () => { done.forEach((s) => store.del('shopping', s.id)); toast('Liste aufgeräumt', { label: 'Rückgängig', run: () => store.putMany('shopping', done) }); } }, icon('trash', 18), 'Gekaufte entfernen'));
  }
  return page;
}

function shopRow(s) {
  return h('div.item.shop' + (s.done ? '.done' : ''), { role: 'button', tabindex: 0, onclick: () => openEditor('shopping', s) },
    h('button.check' + (s.done ? '.on' : ''), { 'aria-label': s.done ? 'Zurück auf die Liste' : 'Gekauft', onclick: (e) => { e.stopPropagation(); haptic(); store.put('shopping', { ...s, done: !s.done, doneAt: s.done ? null : Date.now() }); } }, icon('check', 16)),
    h('div.what', null, h('div.title', null, s.name), s.amount ? h('div.meta', null, s.amount) : null));
}
