import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCommand, similarity } from '../../web/js/commands.js';

const members = [{ id: 'm', name: 'Mama', role: 'parent' }, { id: 'l', name: 'Lena', role: 'child' }, { id: 'b', name: 'Ben', role: 'child' }];
const chores = { l: [{ chore: { id: 'c1', title: 'Tisch decken', points: 2, emoji: '🍽️' }, memberId: 'l', done: false }], b: [{ chore: { id: 'c2', title: 'Müll rausbringen', points: 3 }, memberId: 'b', done: false }, { chore: { id: 'c3', title: 'Zimmer aufräumen', points: 2 }, memberId: 'b', done: true }] };
const evs = [
  { title: 'Zahnarzt', date: '2026-11-23', time: '15:30', memberIds: ['l'] },
  { title: 'Elternabend', date: '2026-11-24', time: '19:00', memberIds: [] },
  { title: 'Fußball', date: '2026-11-23', time: '17:00', memberIds: ['b'] },
];
const ctx = {
  members, meId: 'm', today: '2026-11-23', tomorrow: '2026-11-24', dayAfter: '2026-11-25', weekEnd: '2026-11-29', yearEnd: '2027-11-23',
  dayLabel: (d) => ({ '2026-11-23': 'heute', '2026-11-24': 'morgen' }[d] || d),
  events: (a, b) => evs.filter((e) => e.date >= a && e.date <= b).sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time)),
  openTasks: [{ id: 't1', title: 'Steuererklärung abgeben', date: '2026-11-23', memberIds: ['m'] }],
  shopping: [{ id: 's1', name: 'Milch' }, { id: 's2', name: 'Brot' }],
  meals: (d) => (d === '2026-11-23' ? [{ slot: 'dinner', title: 'Pfannkuchen' }] : []),
  choresFor: (d, mid) => chores[mid] || [],
  balance: (id) => ({ l: 7, b: 12 }[id] || 0),
};
const c = (x) => detectCommand(x, ctx);

test('Fragen', () => {
  assert.equal(c('Was steht heute an?').text, 'Heute sind 2 Termine: 15:30 Uhr Zahnarzt und 17 Uhr Fußball.');
  assert.match(c('Was hat Lena heute?').text, /Zahnarzt/);
  assert.doesNotMatch(c('Was hat Lena heute?').text, /Fußball/);
  assert.equal(c('Was haben wir morgen').text, 'Morgen ist ein Termin: 19 Uhr Elternabend.');
  assert.equal(c('Was gibt es heute zu essen?').text, 'Heute gibt es Pfannkuchen.');
  assert.equal(c('Was gibt es morgen?').text, 'Für morgen ist noch nichts geplant.');
  assert.equal(c('Was steht auf der Einkaufsliste?').text, '2 Sachen: Milch und Brot.');
  assert.equal(c('Wie viele Sterne hat Ben?').text, 'Ben hat 12 Sterne.');
  assert.equal(c('Wie viele Sterne haben die Kinder?').text, 'Lena hat 7 Sterne. Ben hat 12 Sterne.');
  assert.equal(c('Was muss Ben heute noch machen?').text, 'Ben hat heute noch: Müll rausbringen.');
  assert.equal(c('Wann ist der Elternabend?').text, 'Elternabend: morgen um 19 Uhr.');
});

test('Erledigt melden', () => {
  let r = c('Lena hat den Tisch gedeckt');
  assert.equal(r.type, 'action'); assert.deepEqual(r.action, { kind: 'chore', choreId: 'c1', memberId: 'l' });
  r = c('Ben hat den Müll rausgebracht');
  assert.deepEqual(r.action, { kind: 'chore', choreId: 'c2', memberId: 'b' });
  assert.equal(c('Ben hat sein Zimmer aufgeräumt').type, 'answer'); // schon erledigt
  r = c('Steuererklärung ist erledigt');
  assert.deepEqual(r.action, { kind: 'task', taskId: 't1' });
  r = c('Milch ist gekauft');
  assert.deepEqual(r.action, { kind: 'shopping', ids: ['s1'] });
});

test('Normale Einträge bleiben Einträge', () => {
  for (const x of ['Morgen um 15 Uhr Zahnarzt mit Lena', 'Steuererklärung fertig machen bis Freitag', 'Heute gibt es Pizza zum Abendessen', 'Milch und Brot auf die Einkaufsliste', 'Lena muss morgen den Tisch decken', 'Ben hat am Freitag Fußball']) {
    assert.equal(c(x), null, x);
  }
});

test('Ähnlichkeit', () => {
  assert.equal(similarity('Tisch decken', 'Lena hat den Tisch gedeckt'), 1);
  assert.ok(similarity('Zimmer aufräumen', 'hat das Zimmer aufgeräumt') >= 0.99);
});

test('Haushaltsbuch, Pinnwand, Schule per Sprache', () => {
  const ctx2 = { ...ctx, guessCategory: (x) => (/rewe/i.test(x) ? 'Lebensmittel' : 'Sonstiges'),
    lessons: (mid, d) => (mid === 'l' && d === '2026-11-24' ? [{ subject: 'Mathe', end: '11:30' }, { subject: 'Sport', end: '12:30' }] : []) };
  const c2 = (x) => detectCommand(x, ctx2);
  let r = c2('35,50 Euro bei Rewe ausgegeben');
  assert.deepEqual(r.action, { kind: 'budget', type: 'out', amount: 35.5, category: 'Lebensmittel', note: 'Rewe' });
  r = c2('Kindergeld 250 € bekommen');
  assert.equal(r.action.type, 'in'); assert.equal(r.action.category, 'Kindergeld'); assert.equal(r.action.amount, 250);
  assert.equal(c2('Was kostet die Klassenfahrt 120 Euro?')?.action?.kind, undefined);
  r = c2('Schreib an die Pinnwand: bin um 6 zuhause');
  assert.deepEqual(r.action, { kind: 'message', text: 'Bin um 6 zuhause' });
  assert.equal(c2('Nachricht an alle: Abendessen ist fertig').action.text, 'Abendessen ist fertig');
  assert.equal(c2('Was hat Lena morgen in der Schule?').text, 'Lena hat morgen Mathe und Sport – bis 12:30 Uhr.');
  assert.equal(c2('Wer hat heute Schule?').text, 'Lena hat heute keinen Unterricht. Ben hat heute keinen Unterricht.');
  // keine Fehlerkennung
  assert.equal(c2('Morgen um 15 Uhr Zahnarzt mit Lena'), null);
  assert.equal(c2('Termin beim Notar, kostet 300 Euro, nächsten Montag'), null);
});

test('Abfall per Sprache', () => {
  const pk = [
    { date: '2026-11-24', wasteKey: 'gelb', wasteName: 'Gelber Sack / Tonne' }, { date: '2026-11-24', wasteKey: 'bio', wasteName: 'Biotonne' },
    { date: '2026-11-27', wasteKey: 'rest', wasteName: 'Restmüll' }, { date: '2026-12-02', wasteKey: 'papier', wasteName: 'Papier' },
  ];
  const ctx3 = { ...ctx, pickups: (a, b) => pk.filter((p) => p.date >= a && p.date <= b) };
  const c3 = (x) => detectCommand(x, ctx3);
  assert.equal(c3('Welcher Müll kommt morgen?').text, 'Morgen: Gelber Sack / Tonne und Biotonne.');
  assert.equal(c3('Wann kommt die Biotonne?').text, '🟤 Biotonne: morgen.');
  assert.equal(c3('Wann ist Restmüll?').text, '⚫ Restmüll: 2026-11-27.');
  assert.equal(c3('Wann wird das Altpapier abgeholt?').text, '🔵 Papier: 2026-12-02.');
  assert.equal(c3('Welcher Müll kommt heute?').text, 'Heute wird nichts abgeholt. Als Nächstes: Gelber Sack / Tonne morgen.');
  assert.match(c3('Was wird diese Woche abgeholt? Müll').text, /^Diese Woche: Gelber Sack/);
});
