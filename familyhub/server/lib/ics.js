// iCalendar-Feed (Abo in Google-Kalender, Apple-Kalender, Outlook, Thunderbird …)
const RR = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };

function esc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function fold(line) {
  const out = []; let l = line;
  while (Buffer.byteLength(l) > 74) { let cut = 74; while (Buffer.byteLength(l.slice(0, cut)) > 74) cut--; out.push(l.slice(0, cut)); l = ' ' + l.slice(cut); }
  out.push(l); return out.join('\r\n');
}
const d8 = (s) => s.replace(/-/g, '');
const t6 = (t) => t.replace(':', '') + '00';
function plusDay(s) { const [y, m, d] = s.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + 1)); return x.toISOString().slice(0, 10); }

export function buildIcs(state, familyName) {
  const members = Object.fromEntries(state.members.filter((m) => !m.deleted).map((m) => [m.id, m.name]));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FamilyHub//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(familyName || 'FamilyHub')}`, 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const items = [
    ...state.events.filter((e) => !e.deleted && e.date),
    ...state.tasks.filter((t) => !t.deleted && t.date && !t.done).map((t) => ({ ...t, title: '☐ ' + t.title, allDay: !t.time })),
  ];
  for (const e of items) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@familyhub`, `DTSTAMP:${stamp}`);
    if (e.allDay || !e.time) {
      lines.push(`DTSTART;VALUE=DATE:${d8(e.date)}`, `DTEND;VALUE=DATE:${d8(plusDay(e.endDate || e.date))}`);
    } else {
      lines.push(`DTSTART;TZID=Europe/Berlin:${d8(e.date)}T${t6(e.time)}`);
      const end = e.endTime || e.time;
      lines.push(`DTEND;TZID=Europe/Berlin:${d8(e.endDate || e.date)}T${t6(end)}`);
    }
    const who = (e.memberIds || []).map((id) => members[id]).filter(Boolean);
    lines.push(fold(`SUMMARY:${esc(e.title)}${who.length ? esc(' (' + who.join(', ') + ')') : ''}`));
    if (e.location) lines.push(fold(`LOCATION:${esc(e.location)}`));
    if (e.notes) lines.push(fold(`DESCRIPTION:${esc(e.notes)}`));
    if (e.repeat && (RR[e.repeat.freq] || e.repeat.freq === 'weekdays')) {
      const r = e.repeat.freq === 'weekdays' ? 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' : `FREQ=${RR[e.repeat.freq]};INTERVAL=${e.repeat.interval || 1}`;
      lines.push(`RRULE:${r}${e.repeat.until ? ';UNTIL=' + d8(e.repeat.until) : ''}`);
    }
    for (const x of e.exdates || []) lines.push(e.allDay || !e.time ? `EXDATE;VALUE=DATE:${d8(x)}` : `EXDATE;TZID=Europe/Berlin:${d8(x)}T${t6(e.time)}`);
    if (e.remindMin != null && e.time) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${e.remindMin}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
