import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, describe as describeEntry, shoppingCategory } from '../../web/js/nlp.js';

// Samstag, 21.11.2026, 10:00 Uhr
const now = new Date(2026, 10, 21, 10, 0);
const members = [
  { id: 'm1', name: 'Lena' },
  { id: 'm2', name: 'Papa', aliases: ['Thomas'] },
  { id: 'm3', name: 'Mama' },
  { id: 'm4', name: 'Ben' },
];
const p = (t) => parse(t, { now, members });

const cases = [
  ['Morgen um 15 Uhr Zahnarzt mit Lena', { kind: 'event', title: 'Zahnarzt', date: '2026-11-22', time: '15:00', memberIds: ['m1'] }],
  ['morgen um halb vier Zahnarzt', { kind: 'event', title: 'Zahnarzt', date: '2026-11-22', time: '15:30' }],
  ['Termin beim Kinderarzt am Dienstag um 9:30', { kind: 'event', title: 'Beim Kinderarzt', date: '2026-11-24', time: '09:30' }],
  ['Elternabend nächsten Donnerstag um 19 Uhr', { kind: 'event', title: 'Elternabend', date: '2026-11-26', time: '19:00' }],
  ['Fußballtraining jeden Mittwoch von 17 bis 18:30 Uhr für Ben', { kind: 'event', title: 'Fußballtraining', date: '2026-11-25', time: '17:00', endTime: '18:30', memberIds: ['m4'], repeat: { freq: 'weekly', interval: 1 } }],
  ['Oma Geburtstag am 3. Dezember', { kind: 'event', title: 'Oma Geburtstag', date: '2026-12-03', allDay: true, repeat: { freq: 'yearly', interval: 1 } }],
  ['Weihnachtsfeier am 18.12. um sieben abends', { kind: 'event', title: 'Weihnachtsfeier', date: '2026-12-18', time: '19:00' }],
  ['Am 5.1. Schule fängt wieder an', { kind: 'event', date: '2027-01-05' }],
  ['Müll rausbringen', { kind: 'task', title: 'Müll rausbringen', date: null }],
  ['Papa muss morgen den Müll rausbringen', { kind: 'task', title: 'Müll rausbringen', date: '2026-11-22', memberIds: ['m2'] }],
  ['Erinnere mich morgen um 8 daran, die Brotdosen zu packen', { kind: 'task', date: '2026-11-22', time: '08:00', remindMin: 0 }],
  ['Neue Aufgabe: Steuererklärung abgeben, wichtig', { kind: 'task', title: 'Steuererklärung abgeben', priority: true }],
  ['Milch, Eier und Brot auf die Einkaufsliste', { kind: 'shopping', title: 'Milch, Eier, Brot' }],
  ['Wir brauchen noch Waschmittel und zwei Gurken', { kind: 'shopping', title: 'Waschmittel, 2 Gurken' }],
  ['Kaufe Bananen', { kind: 'shopping', title: 'Bananen' }],
  ['Zahnarzt in 2 Wochen um 10 Uhr', { kind: 'event', date: '2026-12-05', time: '10:00' }],
  ['Pflanzen gießen jeden Tag', { kind: 'task', title: 'Pflanzen gießen', repeat: { freq: 'daily', interval: 1 } }],
  ['Schwimmkurs Samstag viertel nach zehn', { kind: 'event', title: 'Schwimmkurs', date: '2026-11-21', time: '10:15' }],
  ['Friseur am Freitag um viertel vor drei', { kind: 'event', title: 'Friseur', date: '2026-11-27', time: '14:45' }],
  ['Familienessen am Sonntag mit allen um 12', { kind: 'event', title: 'Familienessen', date: '2026-11-22', time: '12:00', memberIds: ['m1', 'm2', 'm3', 'm4'] }],
  ['Meeting morgen 14-15 Uhr', { kind: 'event', title: 'Meeting', time: '14:00', endTime: '15:00' }],
  ['Kino heute Abend', { kind: 'event', title: 'Kino', date: '2026-11-21', time: '19:00' }],
  ['Arzttermin für Thomas am Montag um 8 und erinnere mich eine Stunde vorher', { kind: 'event', title: 'Arzttermin', date: '2026-11-23', time: '08:00', memberIds: ['m2'], remindMin: 60 }],
  ['Yoga für 90 Minuten morgen um 18 Uhr', { kind: 'event', title: 'Yoga', time: '18:00', endTime: '19:30', durationMin: 90 }],
  ['Rechnung bezahlen bis Ende der Woche', { kind: 'task', title: 'Rechnung bezahlen', date: '2026-11-27' }],
  ['Kita geschlossen am 24. Dezember', { kind: 'event', date: '2026-12-24', allDay: true }],
  ['Ben vom Training abholen um 18 Uhr', { kind: 'event', time: '18:00', memberIds: ['m4'] }],
  ['Termin morgen früh beim Bürgeramt', { kind: 'event', date: '2026-11-22', time: '08:00', title: 'Beim Bürgeramt' }],
];

for (const [input, expected] of cases) {
  test(input, () => {
    const r = p(input);
    for (const [k, v] of Object.entries(expected)) {
      if (k === 'memberIds') assert.deepEqual([...r[k]].sort(), [...v].sort(), `${k} für "${input}" → ${JSON.stringify(r)}`);
      else assert.deepEqual(r[k], v, `${k} für "${input}" → ${JSON.stringify(r)}`);
    }
  });
}

test('Kategorien für Einkauf', () => {
  assert.equal(shoppingCategory('Milch'), 'Kühlregal');
  assert.equal(shoppingCategory('Bananen'), 'Obst & Gemüse');
  assert.equal(shoppingCategory('Waschmittel'), 'Haushalt');
  assert.equal(shoppingCategory('Irgendwas'), 'Sonstiges');
});

test('Zusammenfassung ist lesbar', () => {
  const r = p('Morgen um 15 Uhr Zahnarzt mit Lena');
  assert.equal(describeEntry(r, { now, members }), 'Termin „Zahnarzt“ morgen um 15:00 Uhr für Lena');
});

test('leere Eingabe', () => {
  assert.equal(p('').kind, 'task');
});
