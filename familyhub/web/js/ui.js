// Kleine UI-Bausteine ohne Framework.

// Schutz: append()/replaceChildren() würden null/false als Text "null" anzeigen – hier einfach überspringen.
if (typeof Element !== 'undefined' && !Element.prototype.__fhSafe) {
  for (const m of ['append', 'prepend', 'replaceChildren']) {
    const orig = Element.prototype[m];
    Element.prototype[m] = function (...a) { return orig.apply(this, a.filter((x) => x != null && x !== false)); };
  }
  Element.prototype.__fhSafe = true;
}
import { haptic } from './native.js';

export function h(tag, attrs, ...children) {
  const [name, ...cls] = tag.split('.');
  const el = name === 'svg' || name === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', name) : document.createElement(name || 'div');
  if (cls.length) el.setAttribute('class', cls.join(' '));
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.setAttribute('class', ((el.getAttribute('class') || '') + ' ' + v).trim());
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) if (sv != null) (sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv)); }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value' && name === 'textarea') el.value = v; // <textarea> kennt kein value-Attribut
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
/** Wie replaceChildren, ignoriert aber null/false. */
export function fill(el, ...children) { el.replaceChildren(); append(el, children); return el; }
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Icons (24er Raster, Strichstärke über CSS)
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  calendar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 2v4M16 2v4',
  check: 'M4 12.5 9 17.5 20 6.5',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 5.5l1 1 2-2M4 11.5l1 1 2-2M4 17.5l1 1 2-2',
  cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.5L21 8H6.2M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6 6 18',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 21a2 2 0 0 0 3.4 0',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  photo: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
  pin: 'M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  sync: 'M21 12a9 9 0 0 1-15.4 6.4L3 16M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5M3 21v-5h5',
  cloudOff: 'M2 2l20 20M5.8 5.8A7 7 0 0 0 7 19h11a4 4 0 0 0 1.5-.3M21.5 16A4.5 4.5 0 0 0 17 10h-.4A7 7 0 0 0 10 5.1',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  power: 'M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01',
  undo: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
  meal: 'M7 2v9M4 2v5a3 3 0 0 0 6 0V2M7 11v11M17 2c-2 1-3 4-3 8h3v12M17 2v20',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
};
export function icon(name, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name] || P.more);
  s.append(p);
  return s;
}

// ---------- Toast ----------
let toastTimer;
export function toast(msg, action) {
  const root = document.getElementById('toast');
  fill(root, h('span', null, msg), action ? h('button.toast-btn', { onclick: () => { root.classList.remove('show'); action.run(); } }, action.label) : null);
  root.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => root.classList.remove('show'), action ? 5000 : 2600);
}

// ---------- Bottom Sheet ----------
const sheetStack = [];
export function sheet(build, { onClose, tall, label } = {}) {
  const host = document.getElementById('sheets');
  const backdrop = h('div.backdrop');
  const panel = h('div.sheet' + (tall ? '.tall' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': label || 'Dialog' });
  const handle = h('div.sheet-handle');
  panel.append(handle);
  const wrap = h('div.sheet-wrap', null, backdrop, panel);
  const api = {
    el: panel,
    close(result) {
      if (api.closed) return; api.closed = true;
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 260);
      const i = sheetStack.indexOf(api); if (i >= 0) sheetStack.splice(i, 1);
      onClose && onClose(result);
    },
  };
  const content = build(api);
  panel.append(content);
  backdrop.addEventListener('click', () => api.close());
  // nach unten wischen zum Schließen
  let startY = null;
  handle.addEventListener('pointerdown', (e) => { startY = e.clientY; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', (e) => { if (startY != null) panel.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`; });
  handle.addEventListener('pointerup', (e) => { if (startY != null && e.clientY - startY > 80) api.close(); panel.style.transform = ''; startY = null; });
  host.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  sheetStack.push(api);
  const first = panel.querySelector('[autofocus]');
  if (first) setTimeout(() => first.focus(), 280);
  return api;
}
export function closeTopSheet() { const s = sheetStack[sheetStack.length - 1]; if (s) { s.close(); return true; } return false; }

export function confirmSheet({ title, text, ok = 'OK', danger, cancel = 'Abbrechen', extra }) {
  return new Promise((resolve) => {
    sheet((s) => h('div.sheet-body', null,
      h('h2.sheet-title', null, title),
      text ? h('p.muted', null, text) : null,
      h('div.btn-col', null,
        h('button.btn' + (danger ? '.danger' : '.primary'), { onclick: () => { s.close(true); } }, ok),
        extra ? h('button.btn.tonal', { onclick: () => { s.close('extra'); } }, extra) : null,
        h('button.btn.ghost', { onclick: () => s.close(false) }, cancel))), { onClose: (r) => resolve(r || false) });
  });
}

export function promptSheet({ title, label, value = '', type = 'text', ok = 'Speichern', placeholder = '', hint }) {
  return new Promise((resolve) => {
    let input;
    sheet((s) => h('form.sheet-body', { onsubmit: (e) => { e.preventDefault(); s.close(input.value); } },
      h('h2.sheet-title', null, title),
      h('label.field', null, h('span', null, label), input = h('input', { type, value, placeholder, autofocus: true, autocomplete: 'off', inputmode: type === 'password' ? undefined : type === 'tel' ? 'numeric' : undefined })),
      hint ? h('p.hint', null, hint) : null,
      h('div.btn-row', null, h('button.btn.ghost', { type: 'button', onclick: () => s.close(null) }, 'Abbrechen'), h('button.btn.primary', { type: 'submit' }, ok))),
    { onClose: (r) => resolve(r ?? null) });
  });
}

export function tap(el) { haptic(); return el; }

// ---------- Formatierung ----------
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MO = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const fmt = {
  WD, WDL, MO,
  parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
  dayDiff(s, now = new Date()) { return Math.round((fmt.parse(s) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5); },
  dayLabel(s, now = new Date()) {
    const diff = fmt.dayDiff(s, now); const d = fmt.parse(s);
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Morgen';
    if (diff === -1) return 'Gestern';
    if (diff === 2) return 'Übermorgen';
    if (diff > 2 && diff < 7) return WDL[d.getDay()];
    return `${WD[d.getDay()]}, ${d.getDate()}. ${MO[d.getMonth()].slice(0, 3)}${d.getMonth() === 4 ? '' : '.'}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}`;
  },
  longDate(d) { return `${WDL[d.getDay()]}, ${d.getDate()}. ${MO[d.getMonth()]}`; },
  time(t) { return t ? t.replace(/^0(\d)/, '$1') : ''; },
  until(dateStr, time, now = new Date()) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = (time || '00:00').split(':').map(Number);
    const ms = new Date(y, m - 1, d, hh, mm) - now;
    const min = Math.round(ms / 60000);
    if (min < 0) return 'läuft';
    if (min < 1) return 'jetzt';
    if (min < 60) return `in ${min} Min.`;
    const hrs = Math.round(min / 60);
    if (hrs < 24) return `in ${hrs} Std.`;
    const days = Math.round(hrs / 24);
    return days === 1 ? 'morgen' : `in ${days} Tagen`;
  },
};

export function initials(name) { return (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(); }
