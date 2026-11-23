import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, lookup, categoryOf, emojiOf, catStore, isDue, STORES } from '../../web/js/catalog.js';

test('Katalog: Umfang, eindeutige Namen, Läden', () => {
  assert.ok(CATALOG.length >= 300, 'Artikel: ' + CATALOG.length);
  const names = CATALOG.map((x) => x.n.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'doppelte Namen: ' + names.filter((n, i) => names.indexOf(n) !== i));
  assert.deepEqual(STORES.map((s) => s.name), ['Marktkauf', 'Rewe', 'Edeka', 'Lidl', 'Aldi', 'Rossmann']);
  assert.equal(catStore('Hygiene & Pflege'), 'rossmann');
});
test('Katalog: Suche & Einordnung', () => {
  assert.equal(lookup('Banane').n, 'Bananen');
  assert.equal(lookup('2 Liter Milch').n, 'Milch');
  assert.equal(lookup('zahnpasta').e, '🪥');
  assert.equal(emojiOf('Grillsoße'), '🥫');
  assert.equal(categoryOf('Bio-Bananen'), 'Obst & Gemüse');
  assert.equal(categoryOf('Spülmaschinentabs'), 'Reinigung & Waschen');
  assert.equal(categoryOf('Haarkur'), 'Hygiene & Pflege');
  assert.equal(isDue({ repeat: 'weekly', lastAdded: Date.now() - 8 * 864e5 }), true);
  assert.equal(isDue({ repeat: 'weekly', lastAdded: Date.now() - 2 * 864e5 }), false);
});
