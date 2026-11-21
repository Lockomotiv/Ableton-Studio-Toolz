// Wiederholungen für Termine und Aufgaben (von Browser, App und Server genutzt).
import { ymd, pad } from './nlp.js';

export function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

/** Nächstes Datum einer Serie nach `dateStr`. */
export function nextDate(dateStr, repeat) {
  const d = parseYmd(dateStr);
  const n = repeat.interval || 1;
  switch (repeat.freq) {
    case 'daily': return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
    case 'weekdays': {
      let r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      while (r.getDay() === 0 || r.getDay() === 6) r = new Date(r.getFullYear(), r.getMonth(), r.getDate() + 1);
      return ymd(r);
    }
    case 'weekly': return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * n));
    case 'monthly': return ymd(new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), daysIn(d.getFullYear(), d.getMonth() + n))));
    case 'yearly': return ymd(new Date(d.getFullYear() + n, d.getMonth(), Math.min(d.getDate(), daysIn(d.getFullYear() + n, d.getMonth()))));
    default: return null;
  }
}
function daysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }

/**
 * Alle Vorkommen eines Termins zwischen from und to (inklusive, YYYY-MM-DD).
 * Liefert Kopien mit `date` des Vorkommens und `occurrence`-Schlüssel.
 */
export function occurrences(ev, from, to) {
  if (!ev.date) return [];
  const out = [];
  const skip = new Set(ev.exdates || []);
  const spanDays = ev.endDate ? Math.round((parseYmd(ev.endDate) - parseYmd(ev.date)) / 864e5) : 0;
  if (!ev.repeat) {
    const end = ev.endDate || ev.date;
    if (end >= from && ev.date <= to) out.push({ ...ev, occurrence: ev.date });
    return out;
  }
  let cur = ev.date;
  let guard = 0;
  // schnell zum Zeitraum springen
  while (cur && cur < from && guard < 5000) {
    const endCur = spanDays ? ymd(new Date(parseYmd(cur).getTime() + spanDays * 864e5)) : cur;
    if (endCur >= from) break;
    cur = nextDate(cur, ev.repeat); guard++;
  }
  while (cur && cur <= to && guard < 6000) {
    if (ev.repeat.until && cur > ev.repeat.until) break;
    if (!skip.has(cur)) {
      const o = { ...ev, date: cur, occurrence: cur };
      if (spanDays) o.endDate = ymd(new Date(parseYmd(cur).getTime() + spanDays * 864e5));
      out.push(o);
    }
    cur = nextDate(cur, ev.repeat); guard++;
  }
  return out;
}

export function minutesOf(t) { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
export function timeFromMinutes(x) { return `${pad(Math.floor(x / 60) % 24)}:${pad(x % 60)}`; }
