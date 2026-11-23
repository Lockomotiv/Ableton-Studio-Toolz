// Rezept-Import per Link: liest die schema.org-Rezeptdaten (JSON-LD), die Chefkoch, Cookidoo (Thermomix),
// Lecker, EatSmarter, Kitchen Stories, Essen & Trinken, BBC Good Food u. v. m. in ihre Seiten einbetten.
// Reine Funktionen (parseRecipeHtml) – das Laden übernimmt die App (ohne CORS) bzw. der Pi.

export const SOURCES = [
  [/chefkoch\./i, 'Chefkoch', '👨‍🍳'],
  [/cookidoo\./i, 'Cookidoo', '🔄'],
  [/thermomix|rezeptwelt\./i, 'Thermomix', '🔄'],
  [/lecker\.de/i, 'Lecker', '🍴'],
  [/eatsmarter\./i, 'EatSmarter', '🥗'],
  [/kitchenstories\./i, 'Kitchen Stories', '📖'],
  [/essen-und-trinken\./i, 'Essen & Trinken', '🍷'],
  [/kuechengoetter\./i, 'Küchengötter', '🍲'],
  [/einfachbacken\./i, 'Einfach Backen', '🧁'],
  [/hellofresh\./i, 'HelloFresh', '📦'],
  [/bbcgoodfood\./i, 'BBC Good Food', '🇬🇧'],
  [/allrecipes\./i, 'Allrecipes', '🇺🇸'],
];

export function sourceOf(url) {
  try {
    const host = new URL(url).hostname;
    for (const [re, name, icon] of SOURCES) if (re.test(host)) return { name, icon, thermomix: /cookidoo|thermomix|rezeptwelt/i.test(host) };
    return { name: host.replace(/^www\./, ''), icon: '🔗', thermomix: false };
  } catch { return { name: 'Link', icon: '🔗', thermomix: false }; }
}

const decode = (s) => String(s ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/\s+/g, ' ').trim();

function isRecipe(o) { const t = o && o['@type']; return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe')); }
function findRecipe(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n); if (r) return r; } return null; }
  if (isRecipe(node)) return node;
  if (node['@graph']) return findRecipe(node['@graph']);
  if (node.mainEntity) return findRecipe(node.mainEntity);
  return null;
}

/** ISO-8601-Dauer (PT1H30M) → Minuten */
export function isoMinutes(d) {
  const m = String(d || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const v = (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
  return v || null;
}
const num = (s) => { const m = String(s ?? '').replace(',', '.').match(/[\d.]+/); return m ? Math.round(parseFloat(m[0]) * 10) / 10 : null; };

function imageOf(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return imageOf(img[img.length > 1 ? 1 : 0]) || imageOf(img[0]);
  return img.url || img.contentUrl || null;
}

function stepsOf(ins) {
  if (!ins) return [];
  if (typeof ins === 'string') {
    const lines = ins.split(/\n+|<br\s*\/?>/i).map(decode).filter(Boolean);
    return lines.length > 1 ? lines : decode(ins).split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])/).filter(Boolean);
  }
  const out = [];
  for (const s of [].concat(ins)) {
    if (typeof s === 'string') out.push(decode(s));
    else if (s['@type'] === 'HowToSection') { if (s.name) out.push('— ' + decode(s.name) + ' —'); out.push(...stepsOf(s.itemListElement)); }
    else if (s.text || s.name) out.push(decode(s.text || s.name));
  }
  return out.filter(Boolean);
}

function servingsOf(y) {
  for (const v of [].concat(y || [])) { const n = num(v); if (n && n < 100) return n; }
  return null;
}

/**
 * @returns {{title, image, servings, ingredients, steps, totalMin, nutrition, tags, url, source} | null}
 */
export function parseRecipeHtml(html, url = '') {
  const blocks = [...String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  let r = null;
  for (const b of blocks) {
    try { r = findRecipe(JSON.parse(b.trim().replace(/^\s*<!--|-->\s*$/g, ''))); } catch { /* defektes JSON überspringen */ }
    if (r) break;
  }
  const src = sourceOf(url);
  if (!r) {
    // Kein Rezept-Markup: wenigstens Titel & Bild übernehmen
    const og = (p) => (html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)`, 'i')) || [])[1];
    const title = decode(og('title') || (html.match(/<title>([^<]+)/i) || [])[1] || '');
    if (!title) return null;
    return { title, image: og('image') || null, servings: null, ingredients: [], steps: [], totalMin: null, nutrition: null, tags: [], url, source: src.name, thermomix: src.thermomix, partial: true };
  }
  const n = r.nutrition || {};
  const nutrition = {
    kcal: num(n.calories), protein: num(n.proteinContent), fat: num(n.fatContent), carbs: num(n.carbohydrateContent),
    fiber: num(n.fiberContent), sugar: num(n.sugarContent),
  };
  const hasNutrition = Object.values(nutrition).some((v) => v != null);
  const kw = [].concat(r.keywords || []).join(',').split(',').concat([].concat(r.recipeCategory || []), [].concat(r.recipeCuisine || []))
    .map((x) => decode(x)).filter((x) => x && x.length < 30);
  return {
    title: decode(r.name) || 'Rezept',
    image: imageOf(r.image),
    servings: servingsOf(r.recipeYield),
    ingredients: [].concat(r.recipeIngredient || r.ingredients || []).map(decode).filter(Boolean),
    steps: stepsOf(r.recipeInstructions),
    totalMin: isoMinutes(r.totalTime) || ((isoMinutes(r.prepTime) || 0) + (isoMinutes(r.cookTime) || 0)) || null,
    nutrition: hasNutrition ? nutrition : null,
    tags: [...new Set(kw)].slice(0, 8),
    url, source: src.name, thermomix: src.thermomix || /thermomix|tm6|tm5|tm7/i.test(kw.join(' ')),
  };
}

/** Links für die Suche nach Ideen bei den großen Rezeptportalen */
export function searchLinks(q) {
  const e = encodeURIComponent(q);
  return [
    ['Chefkoch', '👨‍🍳', `https://www.chefkoch.de/rs/s0/${e}/Rezepte.html`],
    ['Cookidoo (Thermomix)', '🔄', `https://cookidoo.de/search/de-DE?query=${e}`],
    ['EatSmarter (mit Nährwerten)', '🥗', `https://eatsmarter.de/suche/rezepte?ft=${e}`],
    ['Lecker', '🍴', `https://www.lecker.de/suche?search=${e}`],
    ['Kitchen Stories', '📖', `https://www.kitchenstories.com/de/suche?search=${e}`],
  ];
}

/** Mengen skalieren: "500 g Hackfleisch" × 1,5 → "750 g Hackfleisch" */
export function scaleLine(line, factor) {
  if (!factor || factor === 1) return line;
  const frac = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
  return line.replace(/^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[½¼¾⅓⅔])(?:\s*-\s*(\d+(?:[.,]\d+)?))?/, (m, a, b) => {
    const val = (x) => (frac[x] ?? (x.includes('/') ? x.split('/').map((s) => parseFloat(s)).reduce((p, q) => p / q) : parseFloat(x.replace(',', '.'))));
    const fmt = (v) => { const r = Math.round(v * factor * 10) / 10; return String(r).replace('.', ','); };
    return b ? `${fmt(val(a))}-${fmt(val(b))}` : fmt(val(a));
  });
}
