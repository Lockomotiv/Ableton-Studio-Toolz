// Wandansicht & Diashow (Bildschirmschoner): Fotos aus Immich mit Animation, darüber Uhr und Tagesplan.
// Startet automatisch nach der eingestellten Zeit ohne Bedienung (Standard: 1 Minute).
import { h, fmt } from './ui.js';
import { store } from './store.js';
import { agenda, members, today, openTasks } from './domain.js';
import { ymd, addDays } from './nlp.js';
import { mealsOn, SLOTS } from './kitchen.js';
import { choresFor, routinesFor, balance } from './household.js';
import { minutesOf } from './recur.js';
import { slideCfg, loadPhotos, photoUrl, caption } from './photos.js';
import { pickupsOn } from './waste.js';

const N = typeof window !== 'undefined' ? window.FHNative : undefined;
let active = null;

export function wallActive() { return !!active; }

export async function openWall({ screensaver = false } = {}) {
  if (active) return;
  const cfg = slideCfg();
  const overlay = screensaver ? cfg.overlay : 'agenda';
  const root = h('div.wall.ov-' + overlay + (screensaver ? '.saver' : ''), { role: 'dialog', 'aria-label': screensaver ? 'Diashow' : 'Wandansicht' });
  const layers = [h('div.wall-photo'), h('div.wall-photo')];
  const clock = h('div.wall-clock'); const date = h('div.wall-date');
  const cap = h('div.wall-caption');
  const body = h('div.wall-body');
  const close = h('button.wall-close', { 'aria-label': 'Schließen', onclick: (e) => { e.stopPropagation(); closeWall(); } }, '×');
  root.append(...layers, h('div.wall-shade'), h('div.wall-top', null, h('div', null, clock, date), close), body, cap);
  if (screensaver) root.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); closeWall(); }, { once: true });
  document.body.append(root);
  N?.setWallMode?.(true);
  active = { root, timers: [], screensaver };

  const tick = () => {
    const now = new Date();
    clock.textContent = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    date.textContent = fmt.longDate(now);
  };
  const draw = () => { if (overlay === 'agenda') body.replaceChildren(...content()); };
  tick(); draw();
  active.timers.push(setInterval(tick, 10000), setInterval(draw, 60000));
  active.off = store.on((r) => { if (r === 'data') draw(); });
  startSlideshow(layers, cap, cfg);
}

export function closeWall() {
  if (!active) return;
  active.timers.forEach(clearInterval);
  active.off?.();
  active.root.classList.add('closing');
  const r = active.root; setTimeout(() => r.remove(), 300);
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
  const shared = events.filter((e) => !e.memberIds?.length || (e.memberIds.length === ms.length && ms.length > 1));
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
      (() => { const w = pickupsOn(tm); return w.length ? h('div.wall-chip.waste', null, 'Morgen Abfall: ', w.map((p) => p.wasteEmoji + ' ' + p.wasteName).join(', ')) : null; })(),
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
const EFFECTS = ['kenburns', 'fade', 'slide', 'zoom'];
async function startSlideshow(layers, cap, cfg) {
  let photos = []; let base = null; let key = null;
  try { ({ items: photos, base, key } = await loadPhotos({ limit: 150 })); } catch { /* ohne Pi/Immich: Farbverlauf */ }
  if (!active) return;
  if (!photos.length && cfg.source !== 'random') { try { ({ items: photos, base, key } = await loadPhotos({ source: 'random', limit: 150 })); } catch { /* egal */ } }
  if (!active) return;
  if (!photos.length) { layers[0].classList.add('gradient', 'show'); return; }
  let i = 0; let front = 0; let n = 0;
  const preload = (p) => new Promise((ok) => { const img = new Image(); img.onload = () => ok(img.src); img.onerror = () => ok(null); img.src = photoUrl(base, key, p.id, 'preview'); });
  let next = preload(photos[0]);
  const show = async () => {
    const p = photos[i % photos.length]; i++;
    const src = await next;
    next = preload(photos[i % photos.length]); // nächstes Bild schon laden
    if (!active || !src) return;
    const back = 1 - front;
    const fx = cfg.effect === 'mix' ? EFFECTS[n++ % EFFECTS.length] : cfg.effect;
    const el = layers[back];
    el.className = 'wall-photo fx-' + fx;
    el.style.backgroundImage = `url("${src}")`;
    el.style.setProperty('--dur', (cfg.interval + 2) + 's');
    void el.offsetWidth; // Animation neu starten
    el.classList.add('show');
    layers[front].classList.remove('show');
    layers[front].classList.add('leave');
    setTimeout(() => layers[1 - back]?.classList.remove('leave'), 1600);
    front = back;
    cap.textContent = cfg.captions ? caption(p) : '';
    if (i % photos.length === 0) loadPhotos({ limit: 150 }).then((r) => { if (r.items.length) { photos = r.items; key = r.key; } }).catch(() => {});
  };
  await show();
  active?.timers.push(setInterval(show, Math.max(5, cfg.interval) * 1000));
}

// ---------- Bildschirmschoner nach Inaktivität ----------
let idleTimer = null;
export function armScreensaver() {
  clearTimeout(idleTimer);
  const min = +slideCfg().idleMin || 0;
  if (!min || active) return;
  idleTimer = setTimeout(() => {
    if (document.querySelector('.sheet-wrap, .viewer') || document.hidden || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) return armScreensaver();
    openWall({ screensaver: true });
  }, min * 60000);
}
if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, () => { if (!active) armScreensaver(); }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(idleTimer); else armScreensaver(); });
}
