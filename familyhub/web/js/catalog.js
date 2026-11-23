// Artikelkatalog für den Einkauf: gängige Artikel für Wocheneinkauf, Haushalt, Hygiene und Reinigung
// mit Bildkachel (Emoji), Kategorie und – bei Hygiene – Standard-Laden Rossmann.
// Rein (ohne Oberfläche), damit Sprache und Server dieselbe Einordnung nutzen.

export const STORES = [
  { id: 'marktkauf', name: 'Marktkauf', short: 'MK', color: '#0A5BA8' },
  { id: 'rewe', name: 'Rewe', short: 'R', color: '#CC071E' },
  { id: 'edeka', name: 'Edeka', short: 'E', color: '#F5C400', ink: '#1E3C8C' },
  { id: 'lidl', name: 'Lidl', short: 'L', color: '#0050AA', ink: '#FFF000' },
  { id: 'aldi', name: 'Aldi', short: 'A', color: '#00285F' },
  { id: 'rossmann', name: 'Rossmann', short: 'RM', color: '#C3002F' },
];
export const store = (id) => STORES.find((s) => s.id === id) || null;

// [Name der Kategorie, Emoji, Standard-Laden]
export const CATEGORIES = [
  ['Obst & Gemüse', '🥦'], ['Brot & Backwaren', '🍞'], ['Milch, Käse & Eier', '🧀'], ['Fleisch, Wurst & Fisch', '🥩'],
  ['Tiefkühl', '🧊'], ['Nudeln, Reis & Vorrat', '🍝'], ['Konserven & Soßen', '🥫'], ['Frühstück & Aufstriche', '🍯'],
  ['Backen & Gewürze', '🧂'], ['Süßes & Snacks', '🍫'], ['Getränke', '🧃'], ['Baby & Kind', '🍼'],
  ['Hygiene & Pflege', '🧴', 'rossmann'], ['Reinigung & Waschen', '🧽'], ['Haushalt & Papier', '🧻'], ['Tierbedarf', '🐾'], ['Sonstiges', '🛒'],
];
export const CATEGORY_ORDER = CATEGORIES.map((c) => c[0]);
export const catEmoji = (c) => (CATEGORIES.find((x) => x[0] === c) || CATEGORIES[CATEGORIES.length - 1])[1];
export const catStore = (c) => (CATEGORIES.find((x) => x[0] === c) || [])[2] || null;

const L = (cat, list) => list.split(';').map((x) => { const [n, e] = x.trim().split('|'); return { n: n.trim(), e: (e || '').trim() || catEmoji(cat), c: cat }; });

export const CATALOG = [
  ...L('Obst & Gemüse', 'Äpfel|🍎;Bananen|🍌;Birnen|🍐;Orangen|🍊;Mandarinen|🍊;Zitronen|🍋;Limetten|🍋;Weintrauben|🍇;Erdbeeren|🍓;Heidelbeeren|🫐;Himbeeren|🍓;Kiwis|🥝;Mango|🥭;Ananas|🍍;Melone|🍉;Pfirsiche|🍑;Nektarinen|🍑;Kirschen|🍒;Avocado|🥑;Tomaten|🍅;Cherrytomaten|🍅;Gurke|🥒;Paprika|🫑;Zucchini|🥒;Aubergine|🍆;Karotten|🥕;Kartoffeln|🥔;Süßkartoffeln|🍠;Zwiebeln|🧅;Rote Zwiebeln|🧅;Knoblauch|🧄;Ingwer|🫚;Brokkoli|🥦;Blumenkohl|🥦;Spinat|🥬;Salat|🥬;Eisbergsalat|🥬;Feldsalat|🥬;Rucola|🥬;Kohlrabi|🥬;Lauch|🥬;Frühlingszwiebeln|🧅;Champignons|🍄;Mais|🌽;Erbsen (frisch)|🫛;Grüne Bohnen|🫛;Radieschen|🌱;Sellerie|🥬;Kürbis|🎃;Rotkohl|🥬;Weißkohl|🥬;Spargel|🌱;Petersilie|🌿;Schnittlauch|🌿;Basilikum|🌿;Dill|🌿;Kräuter|🌿'),
  ...L('Brot & Backwaren', 'Brot|🍞;Vollkornbrot|🍞;Toastbrot|🍞;Brötchen|🥖;Baguette|🥖;Laugenbrezeln|🥨;Croissants|🥐;Knäckebrot|🍘;Zwieback|🍞;Wraps|🌯;Burger-Brötchen|🍔;Kuchen|🍰;Hefezopf|🍞'),
  ...L('Milch, Käse & Eier', 'Milch|🥛;H-Milch|🥛;Hafermilch|🥛;Butter|🧈;Margarine|🧈;Eier|🥚;Joghurt|🥛;Naturjoghurt|🥛;Fruchtjoghurt|🥛;Skyr|🥛;Quark|🥛;Sahne|🥛;Saure Sahne|🥛;Schmand|🥛;Crème fraîche|🥛;Frischkäse|🧀;Gouda|🧀;Käsescheiben|🧀;Reibekäse|🧀;Mozzarella|🧀;Feta|🧀;Parmesan|🧀;Camembert|🧀;Pudding|🍮;Buttermilch|🥛;Kefir|🥛;Milchreis|🍚'),
  ...L('Fleisch, Wurst & Fisch', 'Hackfleisch|🥩;Hähnchenbrust|🍗;Hähnchenschenkel|🍗;Putenbrust|🍗;Schnitzel|🥩;Rindersteak|🥩;Gulasch|🥩;Bratwurst|🌭;Wiener Würstchen|🌭;Aufschnitt|🥓;Salami|🍕;Kochschinken|🥓;Speck|🥓;Leberwurst|🥓;Frikadellen|🍖;Lachs|🐟;Fischstäbchen|🐟;Thunfisch (Dose)|🐟;Garnelen|🦐;Räucherlachs|🐟;Tofu|🧈'),
  ...L('Tiefkühl', 'TK-Pizza|🍕;Pommes|🍟;TK-Gemüse|🥦;TK-Spinat|🥬;TK-Beeren|🫐;Eis|🍦;Fischstäbchen TK|🐟;TK-Kräuter|🌿;Kroketten|🥔;Blätterteig|🥐;Eiswürfel|🧊'),
  ...L('Nudeln, Reis & Vorrat', 'Nudeln|🍝;Spaghetti|🍝;Penne|🍝;Lasagneplatten|🍝;Reis|🍚;Basmatireis|🍚;Couscous|🍚;Bulgur|🍚;Linsen|🫘;Kichererbsen|🫘;Haferflocken|🥣;Müsli|🥣;Cornflakes|🥣;Mehl|🌾;Zucker|🍬;Puderzucker|🍬;Semmelbrösel|🍞;Kartoffelpüree (Pulver)|🥔;Brühe|🍲;Gnocchi|🥔;Tortellini|🥟'),
  ...L('Konserven & Soßen', 'Passierte Tomaten|🥫;Gehackte Tomaten|🥫;Tomatenmark|🥫;Mais (Dose)|🌽;Kidneybohnen|🫘;Erbsen & Möhren|🥫;Gurken (Glas)|🥒;Apfelmus|🍎;Ketchup|🍅;Mayonnaise|🥚;Senf|🌭;Pesto|🌿;Pastasoße|🥫;Sojasoße|🍶;Essig|🍶;Olivenöl|🫒;Sonnenblumenöl|🌻;Kokosmilch|🥥;Salatdressing|🥗;Suppe (Dose)|🥫'),
  ...L('Frühstück & Aufstriche', 'Marmelade|🍓;Honig|🍯;Nuss-Nougat-Creme|🍫;Erdnussbutter|🥜;Kaffee|☕;Kaffeebohnen|☕;Kaffeepads|☕;Tee|🍵;Kakao|🍫;Brotaufstrich|🍞;Ahornsirup|🍁'),
  ...L('Backen & Gewürze', 'Salz|🧂;Pfeffer|🧂;Paprikapulver|🌶️;Curry|🍛;Zimt|🌰;Oregano|🌿;Backpulver|🧁;Hefe|🍞;Vanillezucker|🍬;Speisestärke|🌾;Schokotropfen|🍫;Nüsse|🥜;Mandeln|🌰;Rosinen|🍇;Kuchenglasur|🍫;Streusel|🎉'),
  ...L('Süßes & Snacks', 'Schokolade|🍫;Gummibärchen|🐻;Kekse|🍪;Chips|🥔;Salzstangen|🥨;Popcorn|🍿;Müsliriegel|🍫;Studentenfutter|🥜;Reiswaffeln|🍘;Bonbons|🍬;Kaugummi|🍬;Cracker|🍘'),
  ...L('Getränke', 'Wasser|💧;Mineralwasser|💧;Apfelsaft|🧃;Orangensaft|🧃;Multivitaminsaft|🧃;Apfelschorle|🧃;Cola|🥤;Limonade|🥤;Eistee|🧋;Sirup|🧃;Bier|🍺;Wein|🍷;Sekt|🍾;Alkoholfreies Bier|🍺'),
  ...L('Baby & Kind', 'Windeln|🧷;Feuchttücher|🧻;Babybrei|🍼;Quetschies|🍎;Babymilch|🍼;Wundschutzcreme|🧴;Kinderzahnpasta|🪥;Schnuller|🍼;Kindershampoo|🧴'),
  ...L('Hygiene & Pflege', 'Zahnpasta|🪥;Zahnbürsten|🪥;Zahnseide|🦷;Mundspülung|🦷;Duschgel|🧴;Shampoo|🧴;Spülung|🧴;Seife|🧼;Flüssigseife|🧼;Deo|🧴;Bodylotion|🧴;Handcreme|🧴;Gesichtscreme|🧴;Sonnencreme|☀️;Rasierer|🪒;Rasierschaum|🪒;Damenhygiene|🌸;Tampons|🌸;Slipeinlagen|🌸;Wattepads|⚪;Wattestäbchen|🦯;Taschentücher|🤧;Pflaster|🩹;Haargummis|🎀;Haarspray|💇;Nagelpflege|💅;Abschminktücher|🧻;Lippenpflege|💄;Kontaktlinsenmittel|👁️;Vitamine|💊'),
  ...L('Reinigung & Waschen', 'Waschmittel|🧺;Colorwaschmittel|🧺;Feinwaschmittel|🧺;Weichspüler|🧺;Fleckentferner|🧺;Spülmittel|🍽️;Spülmaschinentabs|🍽️;Klarspüler|🍽️;Regeneriersalz|🧂;Allzweckreiniger|🧽;Badreiniger|🚿;WC-Reiniger|🚽;WC-Steine|🚽;Glasreiniger|🪟;Entkalker|💧;Bodenreiniger|🧹;Scheuermilch|🧽;Schwämme|🧽;Putztücher|🧽;Mikrofasertücher|🧽;Gummihandschuhe|🧤;Desinfektionsmittel|🧴;Backofenreiniger|🔥;Abflussreiniger|🚰'),
  ...L('Haushalt & Papier', 'Toilettenpapier|🧻;Küchenrolle|🧻;Servietten|🧻;Müllbeutel|🗑️;Gelbe Säcke|🗑️;Alufolie|🍽️;Frischhaltefolie|🍽️;Backpapier|🍪;Gefrierbeutel|🧊;Batterien|🔋;Glühbirne|💡;Kerzen|🕯️;Streichhölzer|🔥;Grillkohle|🔥;Klebeband|📦;Brotdosenpapier|🍞;Spülbürste|🧽;Duftkerze|🕯️'),
  ...L('Tierbedarf', 'Katzenfutter|🐱;Hundefutter|🐶;Katzenstreu|🐱;Leckerlis|🦴;Vogelfutter|🐦'),
];

const norm = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const stem = (s) => norm(s).replace(/(en|n|e|s)$/, '');
const INDEX = new Map(); for (const it of CATALOG) { INDEX.set(norm(it.n), it); INDEX.set(stem(it.n), it); }

/** Katalogeintrag zu einem Namen (auch Einzahl/Mehrzahl: "Banane" → "Bananen", "1 Liter Milch" → "Milch") */
export function lookup(name) {
  const n = norm(name).replace(/^\d+([.,]\d+)?\s*(x|stk|stück|l|liter|kg|g|gramm|ml|pack|packung|packungen|flasche|flaschen|dose|dosen|becher|tüte|beutel|glas|gläser|rolle|rollen|bund)?\s+/, '');
  if (!n) return null;
  return INDEX.get(n) || INDEX.get(stem(n)) || CATALOG.find((it) => norm(it.n).split(' ').some((w) => w.length > 3 && (stem(w) === stem(n)))) || null;
}

// Grobe Einordnung unbekannter Artikel
const RULES = [
  ['Obst & Gemüse', /apfel|äpfel|banane|birne|traube|orange|zitrone|beere|kiwi|mango|melone|tomate|gurke|paprika|zwiebel|knoblauch|kartoffel|karotte|möhre|brokkoli|zucchini|pilz|champignon|avocado|lauch|spinat|kohl|obst|gemüse|kräuter|salat|petersilie|ingwer|kürbis|rettich|fenchel|mangold|pflaume|aprikose|feige|granatapfel/i],
  ['Brot & Backwaren', /brot|brötchen|toast|semmel|croissant|kuchen|brezel|laugen|baguette|zwieback|wrap|fladen/i],
  ['Milch, Käse & Eier', /milch|joghurt|quark|käse|butter|sahne|schmand|ei(er)?\b|skyr|kefir|pudding|mozzarella|feta|ricotta|mascarpone/i],
  ['Fleisch, Wurst & Fisch', /fleisch|hack|wurst|schinken|salami|hähnchen|huhn|pute|rind|schwein|steak|lachs|fisch|thunfisch|garnele|speck|würstchen|filet|schnitzel/i],
  ['Tiefkühl', /tiefkühl|\btk\b|tk-|gefroren|eis\b|pommes|pizza/i],
  ['Nudeln, Reis & Vorrat', /nudel|pasta|spaghetti|reis|mehl|zucker|flocken|müsli|linsen|bohnen|couscous|grieß|polenta|quinoa/i],
  ['Konserven & Soßen', /dose|konserv|soße|sauce|ketchup|senf|mayo|öl|essig|pesto|brühe|dressing/i],
  ['Frühstück & Aufstriche', /marmelade|konfitüre|honig|nutella|aufstrich|kaffee|tee\b|kakao/i],
  ['Backen & Gewürze', /gewürz|salz|pfeffer|backpulver|hefe|vanille|zimt|stärke|glasur|streusel/i],
  ['Süßes & Snacks', /schoko|chips|keks|gummi|bonbon|riegel|snack|nüsse|popcorn|cracker|süß/i],
  ['Getränke', /wasser|saft|cola|limo|sprudel|bier|wein|sekt|schorle|getränk|sirup|tee\s?(flasche)/i],
  ['Baby & Kind', /windel|baby|schnuller|brei|quetsch/i],
  ['Hygiene & Pflege', /zahn|shampoo|dusch|seife|deo|creme|lotion|rasier|tampon|binde|slip|watte|taschent|pflaster|haar|nagel|lippen|kosmetik|make.?up|parfum|tönung|gesicht|hygiene|mundsp|kondom|vitamin|tabletten|medikament/i],
  ['Reinigung & Waschen', /wasch|spül|reiniger|putz|entkalk|schwamm|tücher|handschuh|desinf|weichsp|tabs|klarsp|scheuer|fleck|wc/i],
  ['Haushalt & Papier', /papier|küchenrolle|serviette|müll|beutel|folie|batterie|birne|kerze|streichh|kohle|klebe|anzünder|grill|feuerzeug|tüte|dose\b|glühbirne|sicherung/i],
  ['Tierbedarf', /katze|hund|tier|streu|futter|leckerli|vogel/i],
];
export function categoryOf(name) {
  const hit = lookup(name); if (hit) return hit.c;
  for (const [c, re] of RULES) if (re.test(name)) return c;
  return 'Sonstiges';
}
export function emojiOf(name) { const hit = lookup(name); return hit ? hit.e : catEmoji(categoryOf(name)); }

/** Name schön machen: "  milch " → "Milch" */
export function tidy(name) { const t = String(name || '').trim().replace(/\s+/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); }

/** Fällig? (Stammartikel mit Wiederholung) */
export const REPEATS = { weekly: ['Jede Woche', 7], biweekly: ['Alle 2 Wochen', 14], monthly: ['Jeden Monat', 30] };
export function isDue(entry, now = Date.now()) {
  const r = REPEATS[entry?.repeat]; if (!r) return false;
  const last = entry.lastAdded || entry.lastBought || 0;
  return now - last >= (r[1] - 1) * 864e5;
}
