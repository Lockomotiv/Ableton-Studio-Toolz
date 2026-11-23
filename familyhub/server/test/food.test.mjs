import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipeHtml, sourceOf, scaleLine, isoMinutes } from '../../web/js/recipeimport.js';
import { classify, analyzeWeek, suggest } from '../../web/js/coach.js';

// Aufbau wie bei Chefkoch: Recipe-Objekt direkt, Nährwerte als Text, Anweisungen als String
const CHEFKOCH = `<html><head><title>x</title>
<script type="application/ld+json">{"@context":"http://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
<script type="application/ld+json">{"@context":"http://schema.org","@type":"Recipe","name":"Spaghetti Bolognese &amp; Parmesan",
"image":["https://img.chefkoch-cdn.de/a.jpg","https://img.chefkoch-cdn.de/b.jpg"],"recipeYield":"4 Portionen",
"recipeIngredient":["500 g Hackfleisch, gemischt","1  Zwiebel(n)","1 Dose Tomaten","400 g Spaghetti"],
"recipeInstructions":"Zwiebel würfeln und anbraten. Hackfleisch dazugeben.\\nTomaten zufügen und köcheln lassen.",
"prepTime":"P0DT0H20M","cookTime":"P0DT0H40M","totalTime":"P0DT1H0M",
"nutrition":{"@type":"NutritionInformation","calories":"712 kcal","proteinContent":"38,5g","fatContent":"27g","carbohydrateContent":"76g"},
"keywords":"Hauptspeise,Pasta,Rind","recipeCategory":"Hauptspeise"}</script></head></html>`;

// Aufbau wie bei vielen anderen Seiten (u. a. Cookidoo): @graph, HowToStep/HowToSection, Bild-Objekt
const GRAPH = `<script type='application/ld+json'>{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},
{"@type":["Recipe"],"name":"Linsen-Dal","image":{"@type":"ImageObject","url":"https://example.org/dal.jpg"},"recipeYield":["4","4 Portionen"],
"recipeIngredient":["200 g rote Linsen","1 Dose Kokosmilch","2 TL Currypulver"],
"recipeInstructions":[{"@type":"HowToSection","name":"Dal","itemListElement":[{"@type":"HowToStep","text":"Linsen waschen."},{"@type":"HowToStep","text":"Alles 20 Min. garen."}]}],
"totalTime":"PT25M","keywords":"TM6, vegan"}]}</script>`;

test('Rezept-Import: Chefkoch-Format', () => {
  const r = parseRecipeHtml(CHEFKOCH, 'https://www.chefkoch.de/rezepte/123/spaghetti.html');
  assert.equal(r.title, 'Spaghetti Bolognese & Parmesan');
  assert.equal(r.servings, 4);
  assert.equal(r.ingredients.length, 4);
  assert.equal(r.steps.length, 2);
  assert.equal(r.totalMin, 60);
  assert.deepEqual([r.nutrition.kcal, r.nutrition.protein, r.nutrition.carbs], [712, 38.5, 76]);
  assert.equal(r.source, 'Chefkoch');
  assert.ok(r.image.includes('chefkoch-cdn'));
});

test('Rezept-Import: @graph, Abschnitte, Thermomix', () => {
  const r = parseRecipeHtml(GRAPH, 'https://cookidoo.de/recipes/recipe/de-DE/r123');
  assert.equal(r.title, 'Linsen-Dal');
  assert.equal(r.image, 'https://example.org/dal.jpg');
  assert.deepEqual(r.steps, ['— Dal —', 'Linsen waschen.', 'Alles 20 Min. garen.']);
  assert.equal(r.thermomix, true);
  assert.equal(r.source, 'Cookidoo');
  assert.equal(r.nutrition, null);
});

test('Rezept-Import: Seite ohne Rezeptdaten → nur Titel/Bild', () => {
  const r = parseRecipeHtml('<meta property="og:title" content="Omas Kuchen"><meta property="og:image" content="https://x/y.jpg">', 'https://blog.example/kuchen');
  assert.equal(r.title, 'Omas Kuchen'); assert.equal(r.partial, true);
  assert.equal(parseRecipeHtml('<p>nix</p>', 'https://x'), null);
});

test('Hilfsfunktionen', () => {
  assert.equal(isoMinutes('PT1H30M'), 90);
  assert.equal(scaleLine('500 g Hackfleisch', 1.5), '750 g Hackfleisch');
  assert.equal(scaleLine('½ Zwiebel', 2), '1 Zwiebel');
  assert.equal(scaleLine('2-3 Karotten', 2), '4-6 Karotten');
  assert.equal(scaleLine('Salz', 2), 'Salz');
  assert.equal(sourceOf('https://eatsmarter.de/rezepte/x').name, 'EatSmarter');
});

test('Coach: Einordnung', () => {
  assert.equal(classify({ title: 'Spaghetti Bolognese', ingredients: '500 g Hackfleisch' }).meat, true);
  assert.equal(classify({ title: 'Linsen-Bolognese', ingredients: 'rote Linsen\nTomaten' }).vegetarian, true);
  assert.equal(classify({ title: 'Lachs mit Brokkoli' }).fish, true);
  const dal = classify({ title: 'Dal', ingredients: '200 g rote Linsen\nKokosmilch' });
  assert.ok(dal.vegan && dal.legumes);
});

test('Coach: Wochenanalyse und Vorschläge', () => {
  const days = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];
  const meals = [
    { date: days[0], slot: 'dinner', title: 'Schnitzel mit Pommes' },
    { date: days[1], slot: 'dinner', title: 'Spaghetti Bolognese' },
    { date: days[2], slot: 'dinner', title: 'Bratwurst mit Kartoffelsalat' },
    { date: days[3], slot: 'dinner', title: 'Spaghetti Bolognese' },
  ];
  const a = analyzeWeek(meals, days);
  assert.equal(a.stats.meat, 4);
  assert.equal(a.stats.openDays.length, 3);
  const kinds = a.tips.map((t) => t.icon);
  assert.ok(kinds.includes('🥩') && kinds.includes('🐟') && kinds.includes('🔁') && kinds.includes('🗓️'));
  assert.ok(a.score < 60);
  const fish = suggest({ want: 'fish' });
  assert.ok(fish.length && fish.every((i) => i.fish));
  assert.ok(!suggest({ recent: ['Linsensuppe'], limit: 99 }).some((i) => i.title === 'Linsensuppe'));
  const good = analyzeWeek([
    { date: days[0], slot: 'dinner', title: 'Lachs aus dem Ofen mit Brokkoli' }, { date: days[1], slot: 'dinner', title: 'Gemüse-Curry mit Kichererbsen' },
    { date: days[2], slot: 'dinner', title: 'Ofengemüse mit Feta' }, { date: days[3], slot: 'dinner', title: 'Hähnchen-Gemüse-Pfanne' },
    { date: days[4], slot: 'dinner', title: 'Linsensuppe' }, { date: days[5], slot: 'dinner', title: 'Gemüsepizza' }, { date: days[6], slot: 'dinner', title: 'Spinat-Risotto' }], days);
  assert.ok(good.score >= 90, 'Score ' + good.score);
});

test('Coach: nächster Schwerpunkt', async () => {
  const { nextWant } = await import('../../web/js/coach.js');
  const days = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];
  const meat2 = analyzeWeek([{ date: days[0], slot: 'dinner', title: 'Schnitzel' }, { date: days[1], slot: 'dinner', title: 'Gulasch' }], days);
  assert.equal(nextWant(meat2), 'fish');
  const withFish = analyzeWeek([{ date: days[0], slot: 'dinner', title: 'Schnitzel' }, { date: days[1], slot: 'dinner', title: 'Gulasch' }, { date: days[2], slot: 'dinner', title: 'Lachs' }], days);
  assert.equal(nextWant(withFish), 'vegetarian');
});
