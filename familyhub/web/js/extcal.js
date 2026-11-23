// Externe Kalender (Google, Apple iCloud, Outlook, Schule, Ferien, Müllabfuhr …) per iCal-Adresse.
// Die Liste der Kalender wird synchronisiert (Sammlung "calendars"), die Termine lädt jedes Gerät selbst
// und hält sie zwischengespeichert – so funktioniert es auch ohne Pi.
import { store } from './store.js';
import { http, isApp } from './native.js';
import { parseIcs } from './icsparse.js';
import { wasteType } from './wastetypes.js';

const KEY = 'fh3.extcache';
let cache = load();
function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* voll */ } }

export function calendars() { return store.list('calendars').sort((a, b) => (a.name || '').localeCompare(b.name || '')); }

/** Alle zwischengespeicherten externen Termine (für agenda()). */
export function externalEvents() {
  const out = [];
  for (const c of calendars()) {
    if (c.enabled === false) continue;
    const entry = cache[c.id];
    if (!entry?.events) continue;
    for (const e of entry.events) {
      if (c.kind === 'waste') { const t = wasteType(e.title); out.push({ ...e, memberIds: [], calColor: t[3], calName: 'Abfall', title: `${t[2]} ${e.title}`, waste: true }); }
      else out.push({ ...e, memberIds: c.memberIds || [], calColor: c.color, calName: c.name });
    }
  }
  return out;
}
export function calStatus(id) { return cache[id] || null; }

function normalizeUrl(u) { return String(u || '').trim().replace(/^webcal:\/\//i, 'https://'); }

export async function refreshCalendar(c) {
  const url = normalizeUrl(c.url);
  // Wurde die Adresse inzwischen geändert, gilt dieses (ältere) Ergebnis nicht mehr
  const stale = () => (store.get('calendars', c.id)?.url ?? c.url) !== c.url;
  try {
    let text;
    if (isApp) {
      const r = await http(url, { timeout: 20000, headers: { Accept: 'text/calendar' } });
      if (r.status >= 400) throw new Error('HTTP ' + r.status);
      text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    } else if (store.serverEnabled()) {
      // Browser: CORS verhindert den direkten Abruf → über den Pi holen
      const r = await store.request('api/v2/ics-proxy', { method: 'POST', body: { url }, timeout: 25000 });
      text = r.text;
    } else throw new Error('Im Browser nur mit verbundenem Pi möglich');
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('Keine gültige iCal-Adresse');
    const events = parseIcs(text, { calId: c.id.slice(0, 10) });
    if (stale()) return cache[c.id];
    cache[c.id] = { events, fetched: Date.now(), error: null, count: events.length, url: c.url };
  } catch (e) {
    if (stale()) return cache[c.id] || { error: null };
    cache[c.id] = { ...(cache[c.id] || {}), error: /ENOTFOUND|getaddrinfo/.test(e.message) ? 'Adresse nicht erreichbar (Internet/Name prüfen)' : e.message, tried: Date.now() };
  }
  save();
  store.emit('data');
  return cache[c.id];
}

let running = false;
export async function refreshAll(force = false) {
  if (running) return; running = true;
  try {
    for (const c of calendars()) {
      if (c.enabled === false) continue;
      const e = cache[c.id];
      if (!force && e && Date.now() - (e.fetched || e.tried || 0) < 30 * 60000) continue;
      await refreshCalendar(c);
    }
    // Cache von gelöschten Kalendern entfernen
    const ids = new Set(calendars().map((c) => c.id));
    for (const k of Object.keys(cache)) if (!ids.has(k)) delete cache[k];
    save();
  } finally { running = false; }
}

if (typeof window !== 'undefined') {
  setTimeout(() => refreshAll(), 2500);
  setInterval(() => { if (!document.hidden) refreshAll(); }, 10 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });
}
