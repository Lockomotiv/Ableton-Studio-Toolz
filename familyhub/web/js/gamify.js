// Gamification: Level, Abzeichen, Tagesziel-Bonus, Sternenglas, Klänge, „+N“-Zahlen.
// Alles wird aus dem Punktebuch berechnet (keine neuen Daten auf dem Pi). Welche Abzeichen schon
// gefeiert wurden, merkt sich jedes Gerät selbst – so erscheint die Feier einmal pro Gerät.
import { h, icon, sheet, kidGlyphs } from './ui.js';
import { store } from './store.js';
import { member, childMode, today } from './domain.js';
import { haptic, speak } from './native.js';
import { choresFor, streakDays, weekPoints } from './household.js';

const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Level ----------
export const LEVELS = ['Sternchen', 'Entdecker', 'Helfer', 'Profi', 'Held', 'Superheld', 'Champion', 'Meister', 'Legende', 'Sternenkönig'];
const need = (n) => 5 * n * (n + 1); // Gesamt-Sterne für Level n+1: 0, 10, 30, 60, 100, 150 …
export function lifetime(memberId) { return store.list('points').filter((p) => p.memberId === memberId && p.delta > 0).reduce((s, p) => s + p.delta, 0); }
export function levelFor(total) {
  let n = 0; while (need(n + 1) <= total) n++;
  const from = need(n), to = need(n + 1);
  return { level: n + 1, name: LEVELS[Math.min(n, LEVELS.length - 1)], total, into: total - from, span: to - from, toNext: to - total, p: (total - from) / (to - from) };
}
export const levelOf = (memberId) => levelFor(lifetime(memberId));

// ---------- Abzeichen ----------
const pts = (mid) => store.list('points').filter((p) => p.memberId === mid);
export const BADGES = [
  { id: 'first', e: '🌟', t: 'Erster Stern', d: 'Den allerersten Stern verdient', ok: (m) => lifetime(m) >= 1 },
  { id: 'day', e: '✅', t: 'Alles geschafft', d: 'An einem Tag alle Ämter erledigt', ok: (m) => pts(m).some((p) => p.kind === 'daily') },
  { id: 'streak3', e: '🔥', t: 'Drei am Stück', d: '3 Tage in Folge alle Ämter', ok: (m) => streakDays(m) >= 3, hint: (m) => `${streakDays(m)}/3 Tage` },
  { id: 'streak7', e: '🚀', t: 'Wochen-Held', d: '7 Tage in Folge alle Ämter', ok: (m) => streakDays(m) >= 7, hint: (m) => `${streakDays(m)}/7 Tage` },
  { id: 'routine', e: '🌅', t: 'Routine-Profi', d: 'Eine Routine komplett geschafft', ok: (m) => pts(m).some((p) => p.kind === 'routine') },
  { id: 'early', e: '🐦', t: 'Frühaufsteher', d: 'Ein Amt vor 8 Uhr erledigt', ok: (m) => pts(m).some((p) => p.kind === 'chore' && p.createdAt && new Date(p.createdAt).getHours() < 8) },
  { id: 'team', e: '🙏', t: 'Teamplayer', d: '5 Aufgaben mit Sternen erledigt', ok: (m) => pts(m).filter((p) => p.kind === 'task').length >= 5, hint: (m) => `${pts(m).filter((p) => p.kind === 'task').length}/5` },
  { id: 'week20', e: '💪', t: 'Fleißige Woche', d: '20 Sterne in einer Woche', ok: (m) => weekPoints(m).reduce((s, d) => s + d.pts, 0) >= 20, hint: (m) => `${weekPoints(m).reduce((s, d) => s + d.pts, 0)}/20 diese Woche` },
  { id: 'stars50', e: '⭐', t: '50 Sterne', d: 'Insgesamt 50 Sterne gesammelt', ok: (m) => lifetime(m) >= 50, hint: (m) => `${lifetime(m)}/50` },
  { id: 'redeem', e: '🎁', t: 'Erste Belohnung', d: 'Sterne gegen eine Belohnung getauscht', ok: (m) => pts(m).some((p) => p.kind === 'redeem') },
  { id: 'level5', e: '🦸', t: 'Held', d: 'Level 5 erreicht', ok: (m) => levelOf(m).level >= 5, hint: (m) => `Level ${levelOf(m).level}/5` },
  { id: 'stars200', e: '👑', t: 'Sternenkrone', d: 'Insgesamt 200 Sterne gesammelt', ok: (m) => lifetime(m) >= 200, hint: (m) => `${lifetime(m)}/200` },
];
export const badgesOf = (memberId) => BADGES.map((b) => ({ ...b, on: !!b.ok(memberId) }));
function seen(memberId) { return new Set((store.config.seenBadges || {})[memberId] || []); }
function markSeen(memberId, ids) { const all = { ...(store.config.seenBadges || {}) }; all[memberId] = [...new Set([...(all[memberId] || []), ...ids])]; store.saveConfig({ seenBadges: all }); }
/** Beim ersten Anzeigen: bereits erreichte Abzeichen still als „gesehen“ merken (keine Flut von Feiern) */
export function primeBadges(memberId) { if (!(store.config.seenBadges || {})[memberId]) markSeen(memberId, badgesOf(memberId).filter((b) => b.on).map((b) => b.id)); }

// ---------- Tagesziel-Bonus ----------
const BONUS = 2;
const dailyKey = (mid, date) => `d_${String(mid).replace(/[^A-Za-z0-9_-]/g, '')}_${date.replace(/-/g, '')}`.slice(0, 64);
/** Alle Ämter des Tages erledigt (mind. 2) → +2 Bonus; wieder offen → Bonus zurück. Liefert true, wenn neu vergeben. */
export function checkDailyBonus(memberId, date = today()) {
  const list = choresFor(date, memberId);
  const key = dailyKey(memberId, date);
  const all = list.length >= 2 && list.every((c) => c.done);
  const has = !!store.get('points', key);
  if (all && !has) { store.put('points', { id: key, memberId, delta: BONUS, reason: 'Tagesziel geschafft', date, kind: 'daily' }); return true; }
  if (!all && has) store.del('points', key);
  return false;
}
export const DAILY_BONUS = BONUS;

// ---------- Klänge (WebAudio, ohne Dateien) ----------
let ctx = null;
export function soundsOn() { return store.config.sounds ?? !!childMode(); }
export function chime(kind = 'earn') {
  if (!soundsOn()) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'level' ? [523, 659, 784, 1047, 1319] : kind === 'badge' ? [784, 988, 1175, 1568] : kind === 'goal' ? [659, 784, 988, 1319] : [880, 1175];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain(); const t = ctx.currentTime + i * (kind === 'earn' ? 0.07 : 0.11);
      o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.5);
    });
  } catch { /* ohne Ton */ }
}

// ---------- „+N“ am Fingertipp ----------
export function floatPoints(rect, n, label) {
  if (!rect || calm()) return;
  const el = h('span.float-pts', { 'aria-hidden': 'true' }, `+${n}`, label ? h('small', null, label) : null);
  Object.assign(el.style, { left: rect.left + rect.width / 2 + 'px', top: rect.top + 'px' });
  document.body.append(el);
  el.animate([{ transform: 'translate(-50%, 0) scale(.6)', opacity: 0 }, { transform: 'translate(-50%, -26px) scale(1.15)', opacity: 1, offset: 0.25 }, { transform: 'translate(-50%, -90px) scale(1)', opacity: 0 }], { duration: 1200, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => el.remove();
}

// ---------- Große Momente nacheinander zeigen ----------
const queue = []; let showing = false;
function enqueue(fn) { queue.push(fn); if (!showing) next(); }
function next() { const fn = queue.shift(); if (!fn) { showing = false; return; } showing = true; fn(() => setTimeout(next, 250)); }

export function emblem(level, size = 'md') {
  return h('span.emblem.' + size, { 'aria-label': `Level ${level}` }, h('span.emblem-in', null, h('small', null, 'Level'), h('b', null, level)));
}

function levelUpSheet(m, lv, done) {
  chime('level'); haptic('success'); bigConfetti();
  if (childMode() && store.config.voiceSpeak) speak(`Wahnsinn ${m.name}! Level ${lv.level}: ${lv.name}!`);
  sheet((s) => h('div.sheet-body.moment', { style: { '--c': m.color } },
    h('div.moment-rays'), emblem(lv.level, 'xl'),
    h('p.moment-kicker', null, 'Level aufgestiegen'),
    h('h2.sheet-title', null, `${m.name} ist jetzt ${lv.name}!`),
    h('p.muted', null, `Level ${lv.level} · ${lv.total} Sterne gesammelt · noch ${lv.toNext} bis Level ${lv.level + 1}`),
    h('button.btn.primary.big', { onclick: () => s.close() }, 'Juhu!')), { label: 'Level aufgestiegen', onClose: done });
}
function badgeSheet(m, b, done) {
  chime('badge'); haptic('success');
  sheet((s) => h('div.sheet-body.moment', { style: { '--c': m.color } },
    h('div.moment-rays'), h('span.badge-big', null, b.e),
    h('p.moment-kicker', null, 'Neues Abzeichen'),
    h('h2.sheet-title', null, b.t),
    h('p.muted', null, `${m.name}: ${b.d}`),
    h('button.btn.primary.big', { onclick: () => s.close() }, 'Stark!')), { label: 'Neues Abzeichen', onClose: done });
}
function goalSheet(m, r, done) {
  chime('goal'); bigConfetti();
  if (childMode() && store.config.voiceSpeak) speak(`Juhu ${m.name}! Du hast genug Sterne für ${r.title}.`);
  sheet((s) => h('div.sheet-body.moment', { style: { '--c': m.color } },
    h('div.moment-rays'), h('span.badge-big.gift', null, r.emoji || '🎁'),
    h('p.moment-kicker', null, 'Ziel erreicht'),
    h('h2.sheet-title', null, `${m.name} kann „${r.title}“ einlösen`),
    h('p.muted', null, `${r.cost} Sterne gesammelt – stark!`),
    h('div.btn-col', null,
      h('a.btn.primary', { href: '#sterne', onclick: () => s.close() }, icon('gift', 18), childMode() ? 'Zu meinen Belohnungen' : 'Zu den Belohnungen'),
      h('button.btn.ghost', { onclick: () => s.close() }, 'Weiter sammeln'))), { label: 'Ziel erreicht', onClose: done });
}
function bigConfetti() {
  if (calm()) return;
  const box = h('div.confetti.big', { 'aria-hidden': 'true' });
  const colors = ['#5B86FF', '#9B8CFF', '#F2B544', '#3DBFAC', '#FF7AA8', '#FFFFFF'];
  for (let i = 0; i < 60; i++) box.append(h('i', { style: { left: Math.random() * 100 + '%', background: colors[i % colors.length], animationDelay: Math.random() * 0.4 + 's', animationDuration: 1.4 + Math.random() * 0.9 + 's', transform: `rotate(${Math.random() * 360}deg)` } }));
  document.body.append(box); setTimeout(() => box.remove(), 2600);
}

/** Nach jeder Gutschrift: Level-Aufstieg, Ziel, neue Abzeichen – nacheinander feiern. */
export function onEarn(memberId, earned, fromRect) {
  const m = member(memberId); if (!m) return;
  floatPoints(fromRect, earned);
  chime('earn');
  const total = lifetime(memberId); const before = levelFor(total - earned); const after = levelFor(total);
  primeBadges(memberId);
  const s = seen(memberId);
  const fresh = badgesOf(memberId).filter((b) => b.on && !s.has(b.id));
  if (fresh.length) markSeen(memberId, fresh.map((b) => b.id));
  const bal = store.list('points').filter((p) => p.memberId === memberId).reduce((x, p) => x + (p.delta || 0), 0);
  const reached = store.list('rewards').filter((r) => r.cost > bal - earned && r.cost <= bal).sort((a, b) => b.cost - a.cost)[0];
  const wait = fromRect ? 850 : 200;
  setTimeout(() => {
    if (after.level > before.level) enqueue((done) => levelUpSheet(m, after, done));
    if (reached) enqueue((done) => goalSheet(m, reached, done));
    fresh.forEach((b) => enqueue((done) => badgeSheet(m, b, done)));
  }, wait);
  return { levelUp: after.level > before.level, reached: !!reached, badges: fresh.length };
}

// ---------- Sternenglas: füllt sich bis zur nächsten Belohnung, antippen = klimpern ----------
export function starJar(memberId, p, rewardGlyph) {
  const fill = Math.max(0.04, Math.min(1, p));
  const n = Math.round(fill * 14);
  const stars = [...Array(n)].map((_, i) => h('i', { style: { left: 12 + ((i * 37) % 70) + '%', bottom: 6 + Math.floor(i / 4) * (80 / 4) * fill + ((i * 13) % 9) + '%', animationDelay: (i * 0.13) % 1.4 + 's' } }, kidGlyphs() ? '⭐' : icon('star', 14)));
  const jar = h('button.jar', { 'aria-label': `Sternenglas: ${Math.round(fill * 100)} Prozent bis zur Belohnung`, style: { '--f': fill }, onclick: () => { jar.classList.remove('shake'); void jar.offsetWidth; jar.classList.add('shake'); haptic(); chime('earn'); } },
    h('span.jar-lid', null, rewardGlyph || '🎁'), h('span.jar-glass', null, h('span.jar-fill'), h('span.jar-stars', null, ...stars), h('span.jar-shine')));
  return jar;
}
