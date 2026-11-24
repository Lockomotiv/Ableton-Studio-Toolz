// Ernährungscoach für den Familien-Essensplan.
// Regeln angelehnt an die Empfehlungen der Deutschen Gesellschaft für Ernährung (DGE, 2024):
//   höchstens ~300 g Fleisch pro Woche (≈ 2 Fleischgerichte), 1× Fisch, viel Gemüse & Hülsenfrüchte, Vollkorn.
// Bewusst als Tipps formuliert – kein medizinischer Rat.

const MEAT = /bolognese|carbonara|lasagne|frikassee|cordon bleu|hack|rind|schwein|kalb|lamm|hähnchen|hühnchen|huhn|hühner|pute|ente|gans|wurst|würstchen|bratwurst|speck|bacon|schinken|salami|chorizo|gyros|döner|schnitzel|frikadelle|bulette|kotelett|braten|gulasch|steak|leberkäse|cevapcici|fleisch|nuggets|chicken|beef|pork/i;
const FISH = /fisch|lachs|thunfisch|forelle|kabeljau|seelachs|hering|makrele|garnele|shrimp|scampi|krabbe|muschel|tintenfisch|calamari|sardine|zander|dorade|pangasius|scholle/i;
// Pflanzendrinks („Hafermilch“ …) zählen nicht als tierisch – ohne Lookbehind (läuft auch auf iOS 15)
const ANIMAL_RX = /milch|käse|butter|sahne|joghurt|quark|ei\b|eier|honig|schmand|crème|creme fraiche|mozzarella|parmesan|feta|ricotta|mascarpone/i;
const ANIMAL = { test: (t) => ANIMAL_RX.test(String(t).replace(/(kokos|hafer|soja|mandel|reis|dinkel)milch/gi, '$1drink')) };
const VEG = /gemüse|salat|tomate|gurke|paprika|zucchini|brokkoli|blumenkohl|karotte|möhre|spinat|kohl|lauch|porree|erbsen|bohnen|linsen|kichererbsen|aubergine|kürbis|pilz|champignon|spargel|mangold|rote bete|sellerie|fenchel|zwiebel|mais|süßkartoffel|rucola|radieschen|avocado|kohlrabi|ratatouille|minestrone/i;
const LEGUME = /linsen|kichererbsen|bohnen|erbsen|tofu|tempeh|falafel|hummus|dal\b|edamame/i;
const WHOLE = /vollkorn|dinkel|hafer|naturreis|quinoa|bulgur|buchweizen|hirse|grünkern/i;
const SWEET = /pfannkuchen|pancake|waffel|kaiserschmarrn|milchreis|griesbrei|grießbrei|dampfnudel|germknödel|crêpe|crepe|arme ritter|kuchen|apfelstrudel/i;
const FRIED = /pommes|frittiert|nuggets|currywurst|döner|burger|pizza|schnitzel|backfisch/i;

/** Einordnung eines Gerichts aus Titel, Zutaten und Stichworten */
export function classify({ title = '', ingredients = '', tags = '' } = {}) {
  const text = `${title}\n${Array.isArray(ingredients) ? ingredients.join('\n') : ingredients}\n${tags}`;
  // "Linsen-Bolognese", "Gemüse-Lasagne", "Tofu-Wurst" … sind kein Fleisch
  const meatText = text.replace(/(linsen|gemüse|veggie|soja|tofu|vegan|vegetarisch\w*|kürbis|spinat|pilz|blumenkohl|seitan)[- ]?(bolognese|lasagne|bratwurst|würstchen|wurst|frikadellen?|bällchen|burger|schnitzel|gulasch|hack)/gi, '');
  const meat = MEAT.test(meatText) && !/vegetar|vegan|veggie|ohne fleisch/i.test(text);
  const fish = FISH.test(text) && !/vegan/i.test(text);
  const veg = VEG.test(text);
  const out = {
    meat, fish,
    vegetarian: !meat && !fish,
    vegan: !meat && !fish && (/vegan/i.test(text) || !ANIMAL.test(text)) && !SWEET.test(title),
    veggies: veg,
    legumes: LEGUME.test(text),
    wholegrain: WHOLE.test(text),
    sweet: SWEET.test(title),
    heavy: FRIED.test(title),
  };
  return out;
}

export function badges(c) {
  const b = [];
  if (c.fish) b.push(['🐟', 'Fisch']);
  else if (c.meat) b.push(['🥩', 'Fleisch']);
  else if (c.vegan) b.push(['🌱', 'vegan']);
  else b.push(['🥕', 'vegetarisch']);
  if (c.veggies) b.push(['🥦', 'Gemüse']);
  if (c.legumes) b.push(['🫘', 'Hülsenfrüchte']);
  if (c.wholegrain) b.push(['🌾', 'Vollkorn']);
  return b;
}

export const GOALS = {
  balanced: { label: 'Ausgewogen (DGE)', meatMax: 2, fishMin: 1, vegMin: 3 },
  lessMeat: { label: 'Weniger Fleisch', meatMax: 1, fishMin: 1, vegMin: 5 },
  vegetarian: { label: 'Vegetarisch', meatMax: 0, fishMin: 0, vegMin: 7 },
  light: { label: 'Leichter essen (kcal-bewusst)', meatMax: 2, fishMin: 1, vegMin: 3, kcalMax: 650 },
  kids: { label: 'Kinderfreundlich & ausgewogen', meatMax: 3, fishMin: 1, vegMin: 3 },
};

/**
 * Analyse einer Woche Hauptmahlzeiten.
 * @param meals  [{date, slot, title, recipe?}]
 * @param days   Liste der 7 Datumsstrings
 */
export function analyzeWeek(meals, days, goalKey = 'balanced') {
  const goal = GOALS[goalKey] || GOALS.balanced;
  const main = meals.filter((m) => m.slot !== 'breakfast');
  const items = main.map((m) => ({ ...m, c: classify({ title: m.title, ingredients: m.recipe?.ingredients || '', tags: m.recipe?.tags || '' }) }));
  const count = (k) => items.filter((i) => i.c[k]).length;
  const s = {
    planned: items.length, meat: count('meat'), fish: count('fish'), vegetarian: count('vegetarian'), veggies: count('veggies'),
    legumes: count('legumes'), wholegrain: count('wholegrain'), heavy: count('heavy') + count('sweet'),
    openDays: days.filter((d) => !main.some((m) => m.date === d)),
  };
  // Doppelte Gerichte in der Woche
  const seen = {}; for (const i of items) { const k = i.title.toLowerCase(); seen[k] = (seen[k] || 0) + 1; }
  s.repeats = Object.entries(seen).filter(([, n]) => n > 1).map(([k]) => k);
  // Kalorien pro Portion (nur wo bekannt)
  const kcal = items.map((i) => i.recipe?.nutrition?.kcal).filter((x) => x);
  s.kcalAvg = kcal.length ? Math.round(kcal.reduce((a, b) => a + b, 0) / kcal.length) : null;
  s.kcalKnown = kcal.length;

  const tips = [];
  if (s.meat > goal.meatMax) tips.push({ level: 'warn', icon: '🥩', text: `${s.meat}× Fleisch geplant – ${goal.meatMax ? `empfohlen sind höchstens ${goal.meatMax}` : 'euer Ziel ist fleischfrei'}. Tausche ein Gericht gegen eine Gemüse- oder Linsenvariante.`, want: 'vegetarian' });
  if (s.planned >= 3 && s.fish < goal.fishMin) tips.push({ level: 'info', icon: '🐟', text: 'Diese Woche noch kein Fisch. Einmal pro Woche liefert wertvolles Omega-3 und Jod.', want: 'fish' });
  if (s.planned >= 3 && s.vegetarian < Math.min(goal.vegMin, s.planned)) tips.push({ level: 'info', icon: '🥕', text: `Erst ${s.vegetarian} vegetarische Hauptgerichte – Ziel sind mindestens ${goal.vegMin}.`, want: 'vegetarian' });
  const noVeg = items.filter((i) => !i.c.veggies && !i.c.sweet);
  if (noVeg.length >= 2) tips.push({ level: 'info', icon: '🥦', text: `${noVeg.length} Gerichte ohne erkennbares Gemüse (z. B. „${noVeg[0].title}“) – ein Salat oder Rohkost dazu macht's rund.` });
  if (s.planned >= 4 && !s.legumes) tips.push({ level: 'info', icon: '🫘', text: 'Hülsenfrüchte (Linsen, Kichererbsen, Bohnen) sind günstig, sättigen lange und ersetzen Fleisch prima.', want: 'legumes' });
  if (s.heavy >= 3) tips.push({ level: 'warn', icon: '🍟', text: `${s.heavy} eher deftige oder süße Hauptgerichte – vielleicht eins davon durch etwas Leichtes ersetzen?`, want: 'light' });
  if (goal.kcalMax && s.kcalAvg && s.kcalAvg > goal.kcalMax) tips.push({ level: 'warn', icon: '🔥', text: `Im Schnitt ≈ ${s.kcalAvg} kcal pro Portion (Ziel ≤ ${goal.kcalMax}).`, want: 'light' });
  if (s.repeats.length) tips.push({ level: 'info', icon: '🔁', text: `„${s.repeats[0]}“ steht mehrmals auf dem Plan – Abwechslung bringt mehr Nährstoffe.` });
  if (s.openDays.length) tips.push({ level: 'plan', icon: '🗓️', text: `${s.openDays.length} ${s.openDays.length === 1 ? 'Tag ist' : 'Tage sind'} noch offen – unten gibt es passende Ideen.` });
  if (!tips.length && s.planned) tips.push({ level: 'ok', icon: '🌟', text: 'Super ausgewogene Woche! Weiter so.' });

  // Wochen-Balance 0–100
  const part = (v, t) => (t ? Math.min(1, v / t) : 1);
  const score = s.planned ? Math.round(100 * (
    0.25 * (s.meat <= goal.meatMax ? 1 : Math.max(0, 1 - (s.meat - goal.meatMax) / 3)) +
    0.2 * part(s.fish, goal.fishMin) +
    0.25 * part(s.vegetarian, Math.min(goal.vegMin, s.planned)) +
    0.2 * part(s.veggies, s.planned) +
    0.1 * (s.repeats.length ? 0.5 : 1))) : null;
  return { stats: s, tips, score, goal };
}

/** Was sollte als Nächstes auf den Plan, damit die Woche ausgewogen wird? */
export function nextWant(a) {
  const s = a.stats; const g = a.goal;
  if (g.fishMin && s.fish < g.fishMin && s.planned >= 2) return 'fish';
  if (s.meat >= g.meatMax) return 'vegetarian';
  if (s.planned >= 3 && !s.legumes) return 'legumes';
  return a.tips.find((t) => t.want)?.want || null;
}

// ---------- Ideen-Pool (offline, deutsche Familienküche) ----------
// f: fish, m: meat, v: vegetarisch, q: schnell (≤ 30 Min.), k: kinderbeliebt, l: leicht, h: Hülsenfrüchte, t: Thermomix-Klassiker
export const IDEAS = [
  ['Gemüse-Lasagne', '🥘', 'vk'], ['Linsen-Bolognese', '🍝', 'vhkq'], ['Ofengemüse mit Feta', '🫑', 'vql'], ['Kürbissuppe', '🎃', 'vlt'],
  ['Kartoffelsuppe mit Würstchen', '🥣', 'mkt'], ['Spinat-Lachs-Nudeln', '🐟', 'fqk'], ['Fischstäbchen mit Kartoffelpüree & Erbsen', '🐟', 'fkq'],
  ['Lachs aus dem Ofen mit Brokkoli', '🐟', 'flq'], ['Gemüse-Curry mit Kichererbsen', '🍛', 'vhl'], ['Chili sin Carne', '🌶️', 'vh'],
  ['Chili con Carne', '🌶️', 'm'], ['Pfannkuchen mit Apfelmus', '🥞', 'vkq'], ['Gefüllte Paprika', '🫑', 'm'], ['Shakshuka', '🍳', 'vql'],
  ['Spaghetti Bolognese', '🍝', 'mkt'], ['Kartoffelgratin mit Salat', '🥔', 'vk'], ['Gemüse-Frittata', '🍳', 'vql'], ['Hähnchen-Gemüse-Pfanne', '🍗', 'mql'],
  ['Brokkoli-Nudelauflauf', '🥦', 'vk'], ['Linsensuppe', '🥣', 'vhlt'], ['Risotto mit Erbsen', '🍚', 'vkt'], ['Ofenkartoffeln mit Kräuterquark', '🥔', 'vkq'],
  ['Gemüsepizza vom Blech', '🍕', 'vk'], ['Thunfisch-Tomaten-Pasta', '🐟', 'fq'], ['Fischcurry mit Reis', '🐟', 'f'], ['Grünkohl-Kichererbsen-Eintopf', '🥬', 'vhl'],
  ['Falafel-Wraps', '🌯', 'vhq'], ['Couscous-Salat', '🥗', 'vlq'], ['Hackbällchen in Tomatensoße', '🍝', 'mk'], ['Schupfnudeln mit Sauerkraut', '🥬', 'v'],
  ['Zucchini-Puffer mit Joghurt-Dip', '🥒', 'vlq'], ['Gemüse-Reis-Pfanne', '🍚', 'vq'], ['Milchreis mit Kirschen', '🍒', 'vkt'], ['Kaiserschmarrn', '🥞', 'vk'],
  ['Hühnersuppe', '🍲', 'mlt'], ['Rote-Linsen-Dal', '🍛', 'vhlt'], ['Gnocchi mit Tomaten & Mozzarella', '🍅', 'vkq'], ['Vollkorn-Wraps mit Gemüse', '🌯', 'vlq'],
  ['Forelle mit Kartoffeln & Gurkensalat', '🐟', 'fl'], ['Spargel mit Kartoffeln', '🥔', 'vl'], ['Tortellini-Gemüse-Auflauf', '🧀', 'vk'], ['Bohnen-Eintopf', '🫘', 'vhl'],
  ['Pellkartoffeln mit Kräuterquark', '🥔', 'vklq'], ['Quinoa-Bowl', '🥗', 'vl'], ['Kartoffel-Gemüse-Suppe', '🥣', 'vlt'], ['Seelachs mit Senfsoße', '🐟', 'f'],
  ['Hähnchen-Reis-Topf', '🍗', 'mt'], ['Spätzle mit Linsen', '🫘', 'vh'], ['Tomatensuppe mit Grilled Cheese', '🍅', 'vkq'], ['Gemüsestrudel', '🥧', 'v'],
].map(([title, emoji, f]) => ({ title, emoji, fish: f.includes('f'), meat: f.includes('m'), vegetarian: f.includes('v'), quick: f.includes('q'), kids: f.includes('k'), light: f.includes('l'), legumes: f.includes('h'), thermomix: f.includes('t') }));

/** Ideen passend zu den Coach-Lücken, ohne Gerichte der letzten Wochen */
export function suggest({ want = null, recent = [], kidsOnly = false, quick = false, limit = 8, seed = 0 } = {}) {
  const r = new Set(recent.map((x) => x.toLowerCase()));
  let list = IDEAS.filter((i) => !r.has(i.title.toLowerCase()));
  if (want === 'fish') list = list.filter((i) => i.fish);
  else if (want === 'vegetarian') list = list.filter((i) => i.vegetarian);
  else if (want === 'legumes') list = list.filter((i) => i.legumes);
  else if (want === 'light') list = list.filter((i) => i.light);
  if (kidsOnly) list = list.filter((i) => i.kids || i.quick);
  if (quick) list = list.filter((i) => i.quick);
  // deterministisch gemischt (damit sich die Liste nicht bei jedem Neuzeichnen ändert)
  const rnd = (s) => { let x = s; return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; }; };
  const r2 = rnd(seed + 7);
  return list.map((i) => [r2(), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i).slice(0, limit);
}
