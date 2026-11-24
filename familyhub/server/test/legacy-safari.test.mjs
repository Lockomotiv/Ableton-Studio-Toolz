// iPads mit iOS 15 (Safari 15): kein RegExp-„Lookbehind“. Die App darf es nicht fest im Code haben,
// und die Spracherkennung muss im Ersatz-Modus dieselben Ergebnisse liefern.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'js');

test('Kein Lookbehind als RegExp-Literal im App-Code', () => {
  for (const f of fs.readdirSync(web).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(web, f), 'utf8');
    const lines = src.split('\n').filter((l) => /\/[^/'"`\n]*\(\?<[=!]/.test(l) && !/new RegExp|'\(\?<|"\(\?</.test(l));
    assert.deepEqual(lines, [], `${f} nutzt Lookbehind (Safari < 16.4 bricht ab)`);
  }
});

test('Spracherkennung ohne Lookbehind = mit Lookbehind', async () => {
  const modern = await import('../../web/js/nlp.js');
  globalThis.__fhNoLookbehind = true;
  const legacy = await import('../../web/js/nlp.js?safari15');
  delete globalThis.__fhNoLookbehind;
  const now = new Date(2026, 10, 21, 10, 0);
  const ms = [{ id: 'l', name: 'Lena' }, { id: 'b', name: 'Ben' }];
  for (const s of ['Morgen um halb vier Zahnarzt mit Lena', 'Übermorgen früh Schwimmen', 'Ben muss am Freitag den Müll rausbringen', 'Milch, Brot und zwei Gurken einkaufen', 'Weihnachtsfeier am 18.12. um sieben abends', 'Jeden Montag um 17 Uhr Fußball mit Ben']) {
    const a = modern.parse(s, { members: ms, now }); const b = legacy.parse(s, { members: ms, now });
    assert.deepEqual(b, a, s);
  }
});
