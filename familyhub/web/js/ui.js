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

// ---------- Symbole ----------
// Einheitliche Linien-Symbole (Lucide, 24er Raster, Strichstärke über CSS). Alte Kurznamen werden übersetzt.
import { ICONS, ALIAS, EMOJI } from './icons.js';
const SVGNS = 'http://www.w3.org/2000/svg';
export function icon(name, size = 22, cls = '') {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[ALIAS[name] || name] || ICONS.ellipsis;
  return s;
}

// ---------- Emojis ↔ Symbole ----------
// Kinderprofil: bunte Emojis. Eltern & Erwachsene: ruhige Symbole in einer Formensprache.
// Statt jede Stelle einzeln umzubauen, ersetzt ein Beobachter Emojis in allem, was gezeichnet wird.
// Ältere Browser kennen \p{Extended_Pictographic} evtl. nicht – dann einfacher Bereich statt Absturz
const EMO_RE = (() => { try { return new RegExp('(?:\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic}\\uFE0F?(?:\\u200D\\p{Extended_Pictographic}\\uFE0F?)*)', 'gu'); } catch { return /(?:[\u{1F1E6}-\u{1F1FF}]{2}|[\u{2190}-\u{2BFF}\u{1F000}-\u{1FAFF}]\uFE0F?(?:\u200D[\u{2190}-\u{2BFF}\u{1F000}-\u{1FAFF}]\uFE0F?)*)/gu; } })();
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'OPTION', 'TITLE', 'svg', 'SVG']);
let emojiMode = true; let observer = null;
const isEmo = (m) => m.codePointAt(0) >= 0x2190 && m !== '\u2122';
/** Symbolname für ein Emoji (oder null). */
export function emojiIcon(e) { return e ? EMOJI[String(e).replace(/\uFE0F/g, '')] || null : null; }
/** Emojis im Erwachsenenprofil? */
export const kidGlyphs = () => emojiMode;
/** Text ohne Emojis (Erwachsene) – für Stellen ohne Symbolplatz wie Auswahllisten. */
export function stripEmoji(text) { return text == null ? text : String(text).replace(EMO_RE, (m) => (isEmo(m) ? '' : m)).replace(/\s{2,}/g, ' ').replace(/^[\s:·,]+/, '').trim(); }
export function plain(text) { return emojiMode ? text : stripEmoji(text); }
function swapText(node) {
  const t = node.nodeValue; EMO_RE.lastIndex = 0;
  if (!t || !EMO_RE.test(t)) return;
  const parent = node.parentNode; if (!parent || SKIP.has(parent.nodeName) || parent.closest?.('.keep-emoji')) return;
  if (parent.nodeName === 'OPTION' || parent.nodeName === 'TITLE') { node.nodeValue = plain(t); return; }
  const frag = document.createDocumentFragment(); let last = 0; EMO_RE.lastIndex = 0;
  for (const m of t.matchAll(EMO_RE)) {
    if (!isEmo(m[0])) continue;
    const before = t.slice(last, m.index);
    if (before) frag.append(before);
    const nm = emojiIcon(m[0]) || 'circle-dot'; const ic = icon(nm, 24, 'emo i-' + nm);
    frag.append(ic); last = m.index + m[0].length;
    if (t[last] === ' ' && /\S/.test(t.slice(last + 1))) { frag.append('\u2009'); last++; }
  }
  frag.append(t.slice(last));
  parent.replaceChild(frag, node);
}
function sweep(root) {
  if (root.nodeType === 3) { swapText(root); return; }
  if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const list = []; for (let n = w.nextNode(); n; n = w.nextNode()) list.push(n);
  list.forEach(swapText);
}
/** Schaltet zwischen Emoji (Kind) und Symbolen (Erwachsene) um. */
export function setEmojiMode(kid) {
  document.documentElement.classList.toggle('glyphs', !kid);
  if (kid === emojiMode) return; emojiMode = kid;
  if (kid) { observer?.disconnect(); observer = null; return; }
  sweep(document.body);
  observer = new MutationObserver((recs) => { for (const r of recs) { if (r.type === 'characterData') swapText(r.target); else r.addedNodes.forEach(sweep); } });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
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
  // iOS zeigt die Tastatur nur, wenn noch im selben Antippen fokussiert wird – darum sofort, danach zur Sicherheit noch einmal
  if (first) { try { first.focus({ preventScroll: true }); } catch { /* egal */ } setTimeout(() => { if (document.activeElement !== first) first.focus(); }, 280); }
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

/** Avatar-Inhalt: Kinder sehen ihr Emoji, Erwachsene ein ruhiges Monogramm. */
export function mono(m) { if (!m) return '?'; return (emojiMode && m.emoji) || (m.name || '?')[0].toUpperCase(); }
/** Emoji-Auswahl: Erwachsene sehen jedes Symbol nur einmal (mehrere Emojis teilen sich ein Symbol). */
export function uniqGlyphs(list, current) {
  if (emojiMode) return list;
  const seen = new Set(); const cur = emojiIcon(current);
  return list.filter((e) => { const k = emojiIcon(e) || e; if (seen.has(k)) return false; seen.add(k); return true; }).map((e) => (cur && emojiIcon(e) === cur ? current : e));
}
