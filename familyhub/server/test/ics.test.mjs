import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs } from '../../web/js/icsparse.js';
import { occurrences } from '../../web/js/recur.js';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a1@google.com
DTSTART;TZID=Europe/Berlin:20261124T170000
DTEND;TZID=Europe/Berlin:20261124T183000
RRULE:FREQ=WEEKLY;BYDAY=TU,TH
SUMMARY:Fußball\\, Training
LOCATION:Sportplatz
EXDATE;TZID=Europe/Berlin:20261126T170000
END:VEVENT
BEGIN:VEVENT
UID:a2@google.com
DTSTART;VALUE=DATE:20261221
DTEND;VALUE=DATE:20270105
SUMMARY:Weihnachtsferien
END:VEVENT
BEGIN:VEVENT
UID:a3
DTSTART:20261130T080000Z
DTEND:20261130T090000Z
SUMMARY:Zahnarzt
BEGIN:VALARM
TRIGGER:-PT15M
SUMMARY:ignorieren
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:a4
DTSTART:20200101T080000Z
SUMMARY:Uralt
END:VEVENT
END:VCALENDAR`;

test('iCal-Import: Serien, Ganztägig, UTC, alte Termine', () => {
  const evs = parseIcs(ICS, { calId: 'g' });
  const titles = evs.map((e) => e.title);
  assert.ok(!titles.includes('Uralt'));
  const fb = evs.filter((e) => e.title === 'Fußball, Training');
  assert.equal(fb.length, 2); // Di + Do als einzelne Wochenserien
  assert.deepEqual(fb.map((e) => e.date).sort(), ['2026-11-24', '2026-11-26']);
  assert.equal(fb[0].time, '17:00'); assert.equal(fb[0].endTime, '18:30');
  const thu = fb.find((e) => e.date === '2026-11-26');
  assert.deepEqual(occurrences(thu, '2026-11-20', '2026-12-05').map((o) => o.date), ['2026-12-03']); // 26.11. ausgenommen
  const ferien = evs.find((e) => e.title === 'Weihnachtsferien');
  assert.equal(ferien.allDay, true); assert.equal(ferien.endDate, '2027-01-04');
  const z = evs.find((e) => e.title === 'Zahnarzt');
  assert.equal(z.date, '2026-11-30'); assert.ok(z.readOnly);
});
