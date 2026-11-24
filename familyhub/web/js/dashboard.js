// „Heute“ als Dashboard nach der Vorlage: Kopf mit Gruß, Wetter- und Uhr-Pille; darunter Glaskarten
// (Termine, Nachrichten, Einkauf, Aufgaben, Kinderwelt …). Handy: eine Spalte, Tablet: zwei bis drei Spalten.
import { h, icon, fmt, toast, mono, emojiIcon } from './ui.js';
import { store } from './store.js';
import { agenda, openTasks, sortTasks, completeTask, members, member, childMode, refreshNative, today } from './domain.js';
import { ymd, addDays } from './nlp.js';
import { openCapture } from './capture.js';
import { openEditor } from './editors.js';
import { haptic } from './native.js';
import { personFilter, avatars } from './views.js';
import { choresFor, toggleChore, balance, rewardGoal, kidHero, dayProgress, starBadge, weekBars } from './household.js';
import { todayMealsCard } from './kitchen.js';
import { todaySchoolCard } from './family.js';
import { todayWasteCard } from './waste.js';
import { installBanner } from './iphone.js';
import { weather, place, todayWeatherCard } from './weather.js';
import { wmo, wxEmoji } from './weathercore.js';
import { celebrate } from './fx.js';
import { levelOf } from './gamify.js';
import { logoMark } from './login.js';

/** Glaskarte: Kopf-Label, Titel, Zähl-Chip, Plus-Knopf */
export function dcard({ eyebrow, title, count, add, addLabel, href, cls = '' }, ...body) {
  return h('section.dcard' + cls, null,
    h('div.dc-head', null,
      h('div.dc-titles', null, eyebrow ? h('span.eyebrow', null, eyebrow) : null,
        h('div.dc-title', null, href ? h('a', { href }, title) : h('h2', null, title), count != null && count !== '' ? h('span.dc-count', null, count) : null)),
      add ? h('button.plus-btn', { 'aria-label': addLabel || 'Hinzufügen', onclick: add }, icon('plus', 20)) : null),
    ...body);
}
/** Bestehende Abschnitte (Abfall, Essen, Schule) in Karten verwandeln */
function asCard(section, eyebrow) {
  if (!section) return null;
  section.classList.add('dcard', 'converted');
  const t = section.querySelector('.section-title');
  if (t) { t.classList.add('dc-h'); t.before(h('span.eyebrow', null, eyebrow)); }
  section.querySelectorAll('.card').forEach((c) => c.classList.add('flat'));
  return section;
}

let clockTimer = 0;
function clockPill() {
  const el = h('div.pill-glass.clock', null, h('small', null, 'Jetzt'), h('b', null, ''));
  const tick = () => { el.lastChild.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
  tick(); clearInterval(clockTimer); clockTimer = setInterval(() => { if (!el.isConnected) return clearInterval(clockTimer); tick(); }, 15000);
  return el;
}
function weatherPill() {
  const m = weather();
  if (!m) return h('a.pill-glass.wx', { href: '#wetter' }, icon('cloud-sun', 20), h('span', null, h('b', null, '–°'), h('small', null, 'Wetter')));
  const c = m.current;
  const nm = emojiIcon(wxEmoji(c.code, c.isDay)) || 'cloud';
  return h('a.pill-glass.wx', { href: '#wetter' }, icon(nm, 28, 'emo i-' + nm),
    h('span', null, h('b', null, Math.round(c.temp) + '°'), h('small', null, `${wmo(c.code)[0]} · ${place().name.split(/[ (]/)[0]}`)));
}

export function viewDashboard() {
  const now = new Date(); const td = today(); const tm = ymd(addDays(now, 1));
  const hour = now.getHours();
  const greet = hour < 5 ? 'Gute Nacht' : hour < 11 ? 'Guten Morgen' : hour < 17 ? 'Guten Tag' : hour < 22 ? 'Guten Abend' : 'Gute Nacht';
  const kid = childMode();
  const me = kid || member(store.config.meId);

  const head = h('header.dash-head', null,
    h('div.dash-who', null,
      h('span.dash-logo', null, logoMark(30)),
      h('div', null, h('h1', null, `${greet}, ${me ? me.name : 'liebe Familie'}`, kid ? ' ' + (kid.emoji || '👋') : ''),
        h('small', null, `${store.config.familyName || 'FamilyHub'} · ${fmt.longDate(now)}`))),
    h('div.dash-pills', null, weatherPill(), clockPill()));

  const quick = h('button.quickbar', { onclick: () => openCapture({ mode: 'text' }) },
    icon('sparkle', 20), h('span.qtext', null, kid ? 'Was hast du gemacht?' : 'Was steht an? Einfach sagen oder tippen …'),
    h('span.quick-mic', { onclick: (e) => { e.stopPropagation(); openCapture({ mode: 'voice' }); } }, icon('mic', 20)));

  const cards = kid ? kidCards(kid, td, tm) : parentCards(td, tm, now);
  return h('div.page.today.dash', null, head, installBanner(), quick, personFilter(), h('div.dash-grid', null, ...cards.filter(Boolean)));
}

// ---------------- Eltern / Erwachsene ----------------
function parentCards(td, tm, now) {
  return [termineCard(td, tm, now), kinderweltCard(), aufgabenCard(td), einkaufCard(), nachrichtenCard(), wetterCard(),
    asCard(todayWasteCard(), 'Zuhause'), asCard(todayMealsCard(), 'Küche'), asCard(todaySchoolCard(), 'Schule')];
}
function kidCards(kid, td, tm) {
  return [h('div.dash-wide', null, kidHero(kid)), termineCard(td, tm, new Date()), wetterCard(), asCard(todaySchoolCard(), 'Schule'), asCard(todayMealsCard(), 'Küche')];
}

function termineCard(td, tm, now) {
  const todays = agenda(td, td).filter((e) => !e.waste);
  const tomorrows = agenda(tm, tm).filter((e) => !e.waste);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const next = todays.find((e) => !e.allDay && e.time && +e.time.slice(0, 2) * 60 + +e.time.slice(3, 5) >= nowMin) || todays.find((e) => e.allDay);
  const row = (e) => h('button.dc-ev', { style: { '--c': e.calColor || (e.memberIds?.length ? member(e.memberIds[0])?.color : 'var(--primary)') }, onclick: () => openEditor('events', e) },
    h('span.dc-time', null, e.allDay ? 'ganzt.' : fmt.time(e.time)), h('span.dc-bar'),
    h('span.dc-what', null, h('b', null, e.title), h('small', null, (e.memberIds || []).map((id) => member(id)?.name).filter(Boolean).join(', ') || (e.calName || 'Familie'))));
  const wkStart = ymd(addDays(fmt.parse(td), -((fmt.parse(td).getDay() + 6) % 7)));
  const days = [...Array(7)].map((_, i) => ymd(addDays(fmt.parse(wkStart), i)));
  const wkEv = agenda(days[0], days[6]);
  return dcard({ eyebrow: 'Termine', title: 'Heute im Blick', count: `${todays.length} ${todays.length === 1 ? 'Termin' : 'Termine'}`, add: () => openCapture({ mode: 'text', kind: 'event' }), addLabel: 'Termin hinzufügen', cls: '.tall' },
    h('div.dc-inner.focus', null, h('span.eyebrow.muted', null, 'Tagesfokus'), h('b.dc-big', null, todays.length ? `${todays.length} ${todays.length === 1 ? 'Termin' : 'Termine'}` : 'Freier Tag'),
      h('small', null, next ? `Als Nächstes: ${next.allDay ? 'ganztägig' : fmt.time(next.time) + ' Uhr'} · ${next.title}` : todays.length ? 'Alles für heute erledigt' : 'Nichts im Kalender – genießt den Tag')),
    h('div.dc-inner', null, h('div.dc-sub', null, h('b', null, 'Heute'), h('small', null, `${todays.length} ${todays.length === 1 ? 'Termin' : 'Termine'}`)),
      todays.length ? h('div.dc-list', null, ...todays.slice(0, 5).map(row)) : h('p.soft', null, 'Keine Termine.')),
    tomorrows.length ? h('div.dc-inner', null, h('div.dc-sub', null, h('b', null, 'Morgen'), h('small', null, `${tomorrows.length} ${tomorrows.length === 1 ? 'Termin' : 'Termine'}`)), h('div.dc-list', null, ...tomorrows.slice(0, 3).map(row))) : null,
    h('div.dc-inner', null, h('div.dc-sub', null, h('span', null, h('b', null, 'Diese Woche'), h('small.block', null, 'Antippen für Details')), h('a.chip-glass', { href: '#kalender' }, 'Kalender öffnen')),
      h('div.dc-week', null, ...days.map((d) => {
        const n = wkEv.filter((e) => e.date <= d && (e.endDate || e.date) >= d).length;
        return h('a.dc-day' + (d === td ? '.on' : ''), { href: '#kalender' }, h('small', null, fmt.WD[fmt.parse(d).getDay()]), h('b', null, fmt.parse(d).getDate()), h('i', { style: { opacity: n ? 1 : 0.25 } }));
      }))));
}

function nachrichtenCard() {
  const msgs = store.list('messages').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const meId = store.config.meId;
  const unseen = msgs.filter((m) => m.authorId !== meId && !(m.reactions?.['👍'] || []).includes(meId)).length;
  return dcard({ eyebrow: 'Familie', title: 'Nachrichten', count: unseen ? `${unseen} neu` : '', add: () => { location.hash = 'pinnwand'; }, addLabel: 'Nachricht schreiben', href: '#pinnwand' },
    msgs.length ? h('div.dc-list', null, ...msgs.slice(0, 3).map((m) => {
      const a = member(m.authorId); const seen = (m.reactions?.['👍'] || []).includes(meId);
      return h('div.dc-msg' + (m.pinned ? '.pinned' : ''), { style: { '--c': a?.color } },
        h('div.dc-msg-main', null, h('small', null, h('i.dot'), `${a?.name || 'Familie'} · ${new Date(m.createdAt || Date.now()).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`, m.pinned ? h('span.tag', null, 'Wichtig') : null), h('p', null, m.text)),
        meId && m.authorId !== meId ? h('button.ok-btn' + (seen ? '.on' : ''), { 'aria-label': 'Gelesen', onclick: () => { const r = { ...(m.reactions || {}) }; const l = new Set(r['👍'] || []); seen ? l.delete(meId) : l.add(meId); r['👍'] = [...l]; store.put('messages', { ...m, reactions: r }); haptic(); } }, icon('check', 16)) : null);
    })) : h('div.dc-empty', null, icon('message-circle', 26), h('p', null, 'Noch keine Nachrichten. Kurz „Bin um 6 zuhause“ an alle?')));
}

function einkaufCard() {
  const open = store.list('shopping').filter((s) => !s.done);
  const first = open[0];
  return dcard({ eyebrow: 'Einkauf', title: 'Einkaufsliste', count: `${open.length} offen`, add: () => { location.hash = 'einkauf'; setTimeout(() => document.querySelector('.add-main')?.click(), 250); }, addLabel: 'Artikel hinzufügen', href: '#einkauf' },
    first ? h('a.dc-inner.next', { href: '#einkauf' }, h('span.eyebrow.muted', null, 'Als Nächstes'), h('div.dc-next', null, h('span.dc-next-ic', null, first.emoji || '🛒'), h('span', null, h('b', null, first.name), h('small', null, `${open.length} ${open.length === 1 ? 'Artikel' : 'Artikel'} offen`)))) : h('div.dc-empty', null, icon('shopping-cart', 26), h('p', null, 'Die Liste ist leer.')),
    open.length > 1 ? h('div.pills', null, ...open.slice(1, 9).map((s) => h('span.pill', null, s.name)), open.length > 9 ? h('span.pill.more', null, '+' + (open.length - 9)) : null) : null,
    h('a.dc-action', { href: '#einkauf' }, icon('shopping-basket', 20), h('span', null, 'Einkaufshelfer'), icon('right', 18)));
}

function aufgabenCard(td) {
  const chores = choresFor(td).filter((c) => !c.done && member(c.memberId));
  const tasks = sortTasks(openTasks()).filter((t) => t.date && t.date <= td);
  const total = chores.length + tasks.length;
  const chRow = (it) => { const m = member(it.memberId); return h('div.dc-task', null, h('span.dc-task-ic', null, it.chore.emoji || '⭐'), h('span.dc-what', null, h('b', null, it.chore.title), h('small', null, `${m.name} · +${it.chore.points || 1} ⭐`)), h('span.av', { style: { '--c': m.color } }, mono(m)), h('button.ok-btn', { 'aria-label': 'Erledigt', onclick: (e) => toggleChore(it.chore, m.id, td, e.currentTarget) }, icon('check', 16))); };
  const tRow = (t) => h('div.dc-task', null, h('span.dc-task-ic', null, icon('list-checks', 18)), h('button.dc-what', { onclick: () => openEditor('tasks', t) }, h('b', null, t.title), h('small', null, [t.date < td ? 'überfällig' : 'heute', t.points ? `+${t.points} ⭐` : null].filter(Boolean).join(' · '))), avatars(t.memberIds),
    h('button.ok-btn', { 'aria-label': 'Erledigt', onclick: (e) => { const rect = e.currentTarget.getBoundingClientRect(); const r = completeTask(t); refreshNative(); if (r.earned.length) r.earned.forEach((x) => celebrate(x.memberId, x.pts, t.title, rect)); else toast('Erledigt', { label: 'Rückgängig', run: () => { r.undo(); refreshNative(); } }); haptic('success'); } }, icon('check', 16)));
  return dcard({ eyebrow: 'Haushaltsplan', title: 'Aufgaben', count: `${total} offen`, add: () => openCapture({ mode: 'text', kind: 'task' }), addLabel: 'Aufgabe hinzufügen', href: '#aufgaben' },
    total ? h('div.dc-list', null, ...chores.slice(0, 5).map(chRow), ...tasks.slice(0, 5).map(tRow)) : h('div.dc-empty', null, icon('circle-check', 26), h('p', null, 'Alles erledigt für heute.')),
    h('a.dc-action', { href: '#plan' }, icon('calendar-days', 20), h('span', null, 'Wochenplan & Verteilung'), icon('right', 18)));
}

function kinderweltCard() {
  const kids = members().filter((m) => m.role === 'child');
  if (!kids.length) return null;
  const total = kids.reduce((s, k) => s + balance(k.id), 0);
  const goals = kids.map((k) => rewardGoal(k.id)).filter((g) => g.next || g.ready);
  const nearest = goals.sort((a, b) => b.p - a.p)[0];
  const open = kids.reduce((s, k) => s + choresFor(today(), k.id).filter((c) => !c.done).length, 0);
  const tile = (ic, label, val, href) => h('a.kw-tile', { href }, h('span.kw-ic', null, ic), h('b', null, val), h('small', null, label));
  return dcard({ eyebrow: 'Kinderbereich', title: 'Kinderwelt', href: '#sterne', cls: '.kinderwelt' },
    h('div.kw-tiles', null,
      tile('⭐', 'Punkte', total, '#sterne'),
      tile('🎁', 'Belohnung', nearest ? (nearest.next ? `noch ${nearest.next.cost - nearest.bal}` : 'bereit!') : '–', '#sterne'),
      tile('✅', 'Aufgaben', open ? `${open} offen` : 'fertig', '#aemter')),
    h('div.kw-kids', null, ...kids.map((k) => {
      const pr = dayProgress(k.id); const g = rewardGoal(k.id);
      return h('a.kw-kid', { href: '#sterne', style: { '--c': k.color } },
        h('span.av', { style: { '--c': k.color } }, mono(k)),
        h('span.kw-main', null, h('b', null, k.name, h('span.lv-chip', null, 'Lv ', levelOf(k.id).level)), h('span.goal-track.mini', null, h('i', { style: { '--p': g.p } })), h('small', null, g.next ? `noch ${g.next.cost - g.bal} bis ${g.next.title}` : g.ready ? `${g.ready.title} einlösbar` : `${pr.done}/${pr.total} heute`)),
        starBadge(k), weekBars(k, { labels: false }));
    })),
    h('a.dc-action', { href: '#kinder' }, h('span.kw-teddy', null, '🧸'), h('span', null, h('b', null, 'Kinderwelt öffnen'), h('small.block', null, 'In den eigenen Kinderbereich wechseln')), icon('right', 18)));
}

function wetterCard() {
  const c = todayWeatherCard();
  if (!c) return null;
  return h('section.dcard.wx-holder', null, h('div.dc-head', null, h('div.dc-titles', null, h('span.eyebrow', null, 'Wetter'), h('div.dc-title', null, h('a', { href: '#wetter' }, 'Heute draußen'), h('span.dc-count', null, place().name.split(/[ (]/)[0])))), c);
}
