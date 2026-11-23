// Wandmodus / Bilderrahmen: großer Bildschirm für Flur oder Küche (Tablet an der Wand).
// Zeigt Uhrzeit, Tagesplan pro Person, Essen, Kinder-Fortschritt und eine Diashow aus Immich.
import { h } from './ui.js';
import { fmt } from './ui.js';
import { store } from './store.js';
import { agenda, members, member, today, openTasks } from './domain.js';
import { ymd, addDays } from './nlp.js';
import { mealsOn, SLOTS } from './kitchen.js';
import { choresFor, routinesFor, balance } from './household.js';
import { minutesOf } from './recur.js';

const N = typeof window !== 'undefined' ? window.FHNative : undefined;
let active = null;

export function wallActive() { return !!active; }

export async function openWall({ screensaver = false } = {}) {
  if (active) return;
  const root = h('div.wall' + (screensaver ? '.saver' : ''), { role: 'dialog', 'aria-label': 'Wandansicht' });
  const photoA = h('div.wall-photo'); const photoB = h('div.wall-photo');
  const clock = h('div.wall-clock'); const date = h('div.wall-date');
  const body = h('div.wall-body');
  const close = h('button.wall-close', { 'aria-label': 'Wandansicht schließen', onclick: (e) => { e.stopPropagation(); closeWall(); } }, '×');
  root.append(photoA, photoB, h('div.wall-shade'), h('div.wall-top', null, h('div', null, clock, date), close), body);
  root.addEventListener('click', () => { if (screensaver) closeWall(); });
  document.body.append(root);
  N?.setWallMode?.(true);
  active = { root, timers: [] };

  const tick = () => {
    const now = new Date();
    clock.textContent = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    date.textContent = fmt.longDate(now);
  };
  const draw = () => body.replaceChildren(...content());
  tick(); draw();
  active.timers.push(setInterval(tick, 1000 * 10), setInterval(draw, 60000));
  const off = store.on((r) => { if (r === 'data') draw(); });
  active.off = off;
  startSlideshow(photoA, photoB);
}

export function closeWall() {
  if (!active) return;
  active.timers.forEach(clearInterval);
  active.off?.();
  active.root.classList.add('closing');
  const r = active.root; setTimeout(() => r.remove(), 250);
  active = null;
  N?.setWallMode?.(false);
  armScreensaver();
}

function content() {
  const now = new Date(); const td = today(); const tm = ymd(addDays(now, 1));
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const events = agenda(td, td, { filter: false }).filter((e) => e.allDay || (minutesOf(e.endTime || e.time) ?? 0) >= nowMin);
  const ms = members();
  const cols = [];
  // Spalte pro Person (wie ein Familienplaner an der Wand) + "Alle" für gemeinsame Termine
  const shared = events.filter((e) => !e.memberIds?.length || e.memberIds.length === ms.length && ms.length > 1);
  if (shared.length) cols.push(col('Alle', 'var(--primary)', '👨‍👩‍👧', shared));
  for (const m of ms) {
    const mine = events.filter((e) => e.memberIds?.includes(m.id) && !shared.includes(e));
    const due = openTasks({ filter: false }).filter((t) => t.date && t.date <= td && t.memberIds?.includes(m.id));
    const ch = choresFor(td, m.id); const rt = routinesFor(td, m.id);
    const total = ch.length + rt.reduce((s, r) => s + r.routine.steps.length, 0);
    const done = ch.filter((c) => c.done).length + rt.reduce((s, r) => s + r.done.length, 0);
    if (!mine.length && !due.length && !total) continue;
    cols.push(col(m.name, m.color, m.emoji || m.name[0], mine, due, total ? { done, total, stars: balance(m.id) } : null));
  }
  const meals = mealsOn(td);
  const tomorrow = agenda(tm, tm, { filter: false }).slice(0, 4);
  return [
    cols.length ? h('div.wall-cols', null, ...cols) : h('div.wall-empty', null, 'Heute ist nichts mehr geplant 🌤'),
    h('div.wall-foot', null,
      meals.length ? h('div.wall-chip', null, '🍽️ ', meals.map((m) => `${SLOTS[m.slot]?.[0]}: ${m.title}`).join(' · ')) : null,
      tomorrow.length ? h('div.wall-chip', null, 'Morgen: ', tomorrow.map((e) => (e.allDay ? '' : fmt.time(e.time) + ' ') + e.title).join(' · ')) : null),
  ];
}

function col(name, color, avatar, events, tasks = [], progress = null) {
  return h('div.wall-col', { style: { '--c': color } },
    h('div.wc-head', null, h('span.av', { style: { '--c': color } }, avatar), h('b', null, name), progress ? h('span.wc-stars', null, '⭐ ', progress.stars) : null),
    ...events.map((e) => h('div.wc-ev', null, h('span.wc-time', null, e.allDay ? 'ganzt.' : fmt.time(e.time)), h('span', null, e.title))),
    ...tasks.slice(0, 3).map((t) => h('div.wc-ev.task', null, h('span.wc-time', null, '☐'), h('span', null, t.title))),
    progress ? h('div.wc-progress', null, h('div.progress', null, h('i', { style: { width: (progress.done / progress.total) * 100 + '%' } })), h('small', null, `Ämter & Routinen ${progress.done}/${progress.total}`)) : null);
}

// ---------- Diashow ----------
async function startSlideshow(a, b) {
  let photos = [];
  let base = null; let key = null;
  if (store.serverEnabled()) {
    try {
      const r = await store.request('api/v2/photos');
      photos = r.items || []; key = r.key; base = await store.resolveBase();
    } catch { /* kein Immich eingerichtet */ }
  }
  if (!active) return;
  if (!photos.length) { a.classList.add('gradient', 'show'); return; }
  let i = 0; let front = a; let back = b;
  const show = () => {
    const p = photos[i++ % photos.length];
    const img = new Image();
    img.onload = () => { back.style.backgroundImage = `url("${img.src}")`; back.classList.add('show'); front.classList.remove('show'); [front, back] = [back, front]; };
    img.src = `${base}api/v2/photos/${encodeURIComponent(p.id)}?key=${encodeURIComponent(key)}`;
    if (i % photos.length === 0 && store.serverEnabled()) store.request('api/v2/photos').then((r) => { if (r.items?.length) photos = r.items; }).catch(() => {});
  };
  show();
  active?.timers.push(setInterval(show, (store.config.wallSlideSec || 20) * 1000));
}

// ---------- Bildschirmschoner nach Inaktivität ----------
let idleTimer = null;
export function armScreensaver() {
  clearTimeout(idleTimer);
  const min = +store.config.wallIdleMin || 0;
  if (!min || active) return;
  idleTimer = setTimeout(() => {
    if (document.querySelector('.sheet-wrap') || document.hidden) return armScreensaver();
    openWall({ screensaver: true });
  }, min * 60000);
}
if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) window.addEventListener(ev, () => { if (!active) armScreensaver(); }, { passive: true, capture: true });
}
export { member };
