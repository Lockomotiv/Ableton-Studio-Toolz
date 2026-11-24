// Belohnungs-Effekte: fliegende Sterne, hochzählende Zähler, wachsende Ringe, „Ziel erreicht“.
// Ohne eigene Abhängigkeiten zu den Ansichten – Ämter, Routinen und Aufgaben nutzen dieselben Effekte.
import { h, icon, toast, sheet, kidGlyphs } from './ui.js';
import { store } from './store.js';
import { member, childMode } from './domain.js';
import { haptic, speak } from './native.js';

const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const shown = new Map(); // zuletzt angezeigte Werte → Zähler/Ringe starten beim alten Stand

export function balanceOf(memberId) {
  return store.list('points').filter((p) => p.memberId === memberId).reduce((s, p) => s + (p.delta || 0), 0);
}

/** Zahl, die vom zuletzt gezeigten Wert auf den neuen hochzählt. */
export function counter(key, value, cls = 'num') {
  const el = h('span.' + cls, { 'data-count': key }, String(value));
  const from = shown.get('n:' + key);
  shown.set('n:' + key, value);
  if (from == null || from === value || calm()) return el;
  el.textContent = String(from);
  const t0 = performance.now(); const dur = Math.min(900, 250 + Math.abs(value - from) * 60);
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(from + (value - from) * e));
    if (k < 1) requestAnimationFrame(step); else { el.textContent = String(value); bump(el); }
  };
  requestAnimationFrame(step);
  return el;
}

/** Fortschritt (0..1) als CSS-Variable --p, die vom alten Stand aus wächst. */
export function progressVar(el, key, p) {
  const from = shown.get('p:' + key);
  shown.set('p:' + key, p);
  if (from == null || from === p || calm()) { el.style.setProperty('--p', p); return el; }
  el.style.setProperty('--p', from);
  requestAnimationFrame(() => requestAnimationFrame(() => el.style.setProperty('--p', p)));
  return el;
}

function bump(el) { if (!el?.animate || calm()) return; el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.3,1.6,.5,1)' }); }

/** Sterne fliegen vom angetippten Element zum Sternezähler der Person (oder zum Aufgaben-Tab). */
export function flyStars(fromRect, memberId, n = 3) {
  if (!fromRect || calm()) return;
  setTimeout(() => {
    const target = document.querySelector(`[data-stars="${memberId}"]`) || document.querySelector('[data-stars="*"]');
    const to = target?.getBoundingClientRect();
    const count = Math.max(3, Math.min(9, n * 2));
    for (let i = 0; i < count; i++) {
      const star = h('span.fly-star', { 'aria-hidden': 'true' }, kidGlyphs() ? '⭐' : icon('star', 22));
      const x0 = fromRect.left + fromRect.width / 2 - 11 + (Math.random() - 0.5) * fromRect.width * 0.5;
      const y0 = fromRect.top + fromRect.height / 2 - 11 + (Math.random() - 0.5) * fromRect.height * 0.4;
      const x1 = to ? to.left + to.width / 2 - 11 : x0 + (Math.random() - 0.5) * 120;
      const y1 = to ? to.top + to.height / 2 - 11 : y0 - 160;
      Object.assign(star.style, { left: x0 + 'px', top: y0 + 'px' });
      document.body.append(star);
      const mx = (x0 + x1) / 2 + (Math.random() - 0.5) * 140; const my = Math.min(y0, y1) - 60 - Math.random() * 80;
      const a = star.animate([
        { transform: 'translate(0,0) scale(.4) rotate(0deg)', opacity: 0 },
        { transform: `translate(${(mx - x0) * 0.6}px, ${(my - y0) * 0.6}px) scale(1.25) rotate(90deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${x1 - x0}px, ${y1 - y0}px) scale(.55) rotate(220deg)`, opacity: to ? 0.9 : 0 },
      ], { duration: 720 + i * 55, delay: i * 45, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'forwards' });
      a.onfinish = () => { star.remove(); if (i === count - 1 && target) bump(target); };
    }
  }, 90); // nach dem Neuzeichnen, damit der Zähler schon steht
}

export function confetti() {
  if (calm()) return;
  const box = h('div.confetti', { 'aria-hidden': 'true' });
  const colors = ['#E4572E', '#F2B544', '#1F6F66', '#2E86AB', '#9B5DE5', '#7A9E3B'];
  for (let i = 0; i < 32; i++) box.append(h('i', { style: { left: Math.random() * 100 + '%', background: colors[i % colors.length], animationDelay: Math.random() * 0.25 + 's', transform: `rotate(${Math.random() * 360}deg)` } }));
  document.body.append(box);
  setTimeout(() => box.remove(), 1700);
}

/** Lob + Sterneflug; Level-Aufstieg, Ziel und neue Abzeichen feiert gamify.js nacheinander. */
export function celebrate(memberId, pts, text, fromRect) {
  const m = member(memberId);
  haptic('success');
  flyStars(fromRect, memberId, pts);
  import('./gamify.js').then((g) => {
    const r = g.onEarn(memberId, pts, fromRect) || {};
    if (!r.levelUp && !r.reached && !r.badges) toast(`${text || 'Super'}${m ? ', ' + m.name : ''}! +${pts} ⭐`);
  });
  if (m?.role === 'child' || childMode()) confetti();
  if (childMode() && store.config.voiceSpeak) speak(`${text || 'Super gemacht'}! Plus ${pts} Sterne.`);
}

/** Großer Moment: genug Sterne für eine Belohnung. */
export function goalReached(m, r) {
  confetti();
  if (childMode() && store.config.voiceSpeak) speak(`Juhu ${m.name}! Du hast genug Sterne für ${r.title}.`);
  sheet((s) => h('div.sheet-body.goal-sheet', { style: { '--c': m.color } },
    h('div.goal-burst', null, h('span.goal-glyph', null, r.emoji || '🎁')),
    h('p.goal-kicker', null, 'Ziel erreicht'),
    h('h2.sheet-title', null, `${m.name} kann „${r.title}“ einlösen`),
    h('p.muted', null, `${r.cost} Sterne gesammelt – stark!`),
    h('div.btn-col', null,
      h('a.btn.primary', { href: '#sterne', onclick: () => s.close() }, icon('gift', 18), childMode() ? 'Zu meinen Belohnungen' : 'Zu den Belohnungen'),
      h('button.btn.ghost', { onclick: () => s.close() }, 'Weiter sammeln'))), { label: 'Ziel erreicht' });
}
