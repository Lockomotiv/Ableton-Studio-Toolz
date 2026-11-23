// iCalendar-Import (Google, Apple iCloud, Outlook, Schul-/Ferienkalender …) → FamilyHub-Termine.
// Bewusst schlank: deckt die Formate ab, die die großen Anbieter als "geheime iCal-Adresse" liefern.

const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hmOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function unfold(text) { return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }
function unescape(v) { return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }

/** Wandelt ein DTSTART/DTEND in {date, time|null} in lokaler Zeit des Geräts. */
function parseDate(value, params) {
  const v = value.trim();
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, time: null };
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) {
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)));
    return { date: ymdOf(dt), time: hmOf(dt) };
  }
  // TZID: Für Europe/Berlin & "floating" stimmt die Wandzeit. Andere Zonen werden über Intl umgerechnet.
  const tz = params.TZID;
  if (tz && !/berlin|vienna|wien|zurich|zürich|amsterdam|paris|rome|madrid|brussels|w\. europe/i.test(tz)) {
    try {
      const guess = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
      const inTz = new Date(guess.toLocaleString('en-US', { timeZone: tz }));
      const offset = inTz.getTime() - new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
      const dt = new Date(guess.getTime() - offset);
      return { date: ymdOf(dt), time: hmOf(dt) };
    } catch { /* unbekannte Zone → Wandzeit */ }
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

function parseLine(line) {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  const head = line.slice(0, idx); const value = line.slice(idx + 1);
  const [name, ...ps] = head.split(';');
  const params = {};
  for (const p of ps) { const [k, v] = p.split('='); if (k) params[k.toUpperCase()] = (v || '').replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params, value };
}

function addDaysStr(s, n) { const [y, m, d] = s.split('-').map(Number); return ymdOf(new Date(y, m - 1, d + n)); }

/**
 * @returns Array von Terminen im FamilyHub-Format (read-only, mit `external: calId`).
 *   Mehrfach-Wochentage (BYDAY=MO,WE) werden in einzelne Wochenserien zerlegt.
 */
export function parseIcs(text, { calId = 'ext', memberIds = [], horizonPast = 60 } = {}) {
  const lines = unfold(text).split('\n');
  const events = [];
  let cur = null; let depth = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; }
    if (line.startsWith('END:') && line !== 'END:VEVENT') { depth--; continue; }
    if (line === 'END:VEVENT') { events.push(cur); cur = null; continue; }
    if (depth > 0) continue; // VALARM o. ä.
    const p = parseLine(line); if (!p) continue;
    if (p.name === 'SUMMARY') cur.title = unescape(p.value);
    else if (p.name === 'LOCATION') cur.location = unescape(p.value);
    else if (p.name === 'DESCRIPTION') cur.notes = unescape(p.value).slice(0, 500);
    else if (p.name === 'UID') cur.uid = p.value;
    else if (p.name === 'DTSTART') cur.start = parseDate(p.value, p.params);
    else if (p.name === 'DTEND') cur.end = parseDate(p.value, p.params);
    else if (p.name === 'RRULE') cur.rrule = Object.fromEntries(p.value.split(';').map((kv) => kv.split('=')));
    else if (p.name === 'EXDATE') for (const v of p.value.split(',')) { const d = parseDate(v, p.params); if (d) cur.exdates.push(d.date); }
    else if (p.name === 'STATUS') cur.status = p.value;
    else if (p.name === 'RECURRENCE-ID') cur.recurrenceId = parseDate(p.value, p.params);
  }

  const cutoff = ymdOf(new Date(Date.now() - horizonPast * 864e5));
  const out = [];
  // Einzeln geänderte Vorkommen einer Serie: Original-Vorkommen ausschließen
  const overrides = events.filter((e) => e.recurrenceId && e.uid);
  for (const e of events) {
    if (!e.start || e.status === 'CANCELLED' || e.recurrenceId) continue;
    const allDay = !e.start.time;
    let endDate = e.end?.date || e.start.date;
    if (allDay && e.end) endDate = addDaysStr(e.end.date, -1); // DTEND ist bei Ganztägigem exklusiv
    const base = {
      id: `x${calId}_${hash(e.uid || e.title + e.start.date)}`.slice(0, 60),
      title: e.title || '(ohne Titel)', date: e.start.date, time: e.start.time, endTime: allDay ? null : e.end?.time || null,
      endDate: endDate > e.start.date ? endDate : null, allDay, location: e.location || '', notes: e.notes || '',
      memberIds, external: calId, readOnly: true, remindMin: null,
      exdates: [...e.exdates, ...overrides.filter((o) => o.uid === e.uid).map((o) => o.recurrenceId.date)],
    };
    const r = e.rrule;
    if (r && r.FREQ) {
      const freq = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[r.FREQ];
      if (!freq) continue;
      const repeat = { freq, interval: +(r.INTERVAL || 1) };
      if (r.UNTIL) repeat.until = parseDate(r.UNTIL, {})?.date;
      if (r.COUNT) repeat.count = +r.COUNT;
      if (repeat.until && repeat.until < cutoff) continue;
      const days = freq === 'weekly' && r.BYDAY ? r.BYDAY.split(',').map((d) => WD[d.replace(/^[+-]?\d+/, '')]).filter((x) => x != null) : null;
      if (days && days.length) {
        const [y, m, d] = base.date.split('-').map(Number);
        const startWd = new Date(y, m - 1, d).getDay();
        for (const wd of days) {
          const diff = (wd - startWd + 7) % 7;
          const date = addDaysStr(base.date, diff);
          if (days.length === 5 && [1, 2, 3, 4, 5].every((x) => days.includes(x)) && repeat.interval === 1) {
            out.push({ ...base, repeat: { ...repeat, freq: 'weekdays' } });
            break;
          }
          out.push({ ...base, id: (base.id + '_' + wd).slice(0, 64), date, repeat: { ...repeat, count: repeat.count ? Math.ceil(repeat.count / days.length) : undefined } });
        }
        continue;
      }
      if (repeat.count && !repeat.until) repeat.until = estimateUntil(base.date, repeat);
      out.push({ ...base, repeat });
    } else {
      if ((base.endDate || base.date) < cutoff) continue;
      out.push(base);
    }
  }
  return out;
}

function estimateUntil(date, r) {
  const [y, m, d] = date.split('-').map(Number);
  const n = (r.count - 1) * (r.interval || 1);
  const dt = r.freq === 'daily' ? new Date(y, m - 1, d + n) : r.freq === 'weekly' ? new Date(y, m - 1, d + 7 * n) : r.freq === 'monthly' ? new Date(y, m - 1 + n, d) : new Date(y + n, m - 1, d);
  return ymdOf(dt);
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
