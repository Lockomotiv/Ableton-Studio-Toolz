// FamilyHub – deutsche Spracheingabe → Termin / Aufgabe / Einkauf.
// Reine Funktion ohne Abhängigkeiten. Läuft im Browser, in der App und auf dem Server.
//
//   parse("Morgen um halb vier Zahnarzt mit Lena", { now, members })
//   → { kind: "event", title: "Zahnarzt", date: "2026-11-22", time: "15:30", memberIds: [...] }

import { categoryOf, CATEGORY_ORDER } from './catalog.js';

const WEEKDAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const MONTH_ALIASES = { jan: 0, feb: 1, 'mär': 2, maerz: 2, mrz: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, okt: 9, nov: 10, dez: 11 };

const UNITS = { null: 0, eins: 1, ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, 'fünf': 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, 'zwölf': 12, zwoelf: 12, dreizehn: 13, vierzehn: 14, 'fünfzehn': 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 };
const TENS = { zwanzig: 20, 'dreißig': 30, dreissig: 30, vierzig: 40, 'fünfzig': 50, fuenfzig: 50 };
// "ein/eine/einen…" nur in Zeit-/Mengenkontext ersetzen, sonst würde aus "eine Torte" → "1 Torte".
const ARTICLE_WORDS = new Set(['ein', 'eine', 'einen', 'einem', 'einer']);

const W = '(?<![\\p{L}\\d])'; // Wortanfang (Unicode-sicher, \b kennt kein ä/ö/ü)
const E = '(?![\\p{L}\\d])'; // Wortende

function rx(src, flags = 'iu') { return new RegExp(src.replace(/\\b<|\\b>/g, (m) => (m === '\\b<' ? W : E)), flags); }

export function pad(n) { return String(n).padStart(2, '0'); }
export function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function addDays(d, n) { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return r; }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

/** Zahlwörter → Ziffern ("halb drei" → "halb 3", "einundzwanzig" → "21"). */
export function wordsToNumbers(text) {
  const unitKeys = Object.keys(UNITS).filter((k) => !ARTICLE_WORDS.has(k)).sort((a, b) => b.length - a.length).join('|');
  const tenKeys = Object.keys(TENS).join('|');
  let t = text.replace(rx(`\\b<(${unitKeys}|ein)und(${tenKeys})\\b>`), (_, u, z) => String((UNITS[u.toLowerCase()] ?? 1) + TENS[z.toLowerCase()]));
  t = t.replace(rx(`\\b<(${tenKeys})\\b>`), (m) => String(TENS[m.toLowerCase()]));
  t = t.replace(rx(`\\b<(${unitKeys})\\b>`), (m) => String(UNITS[m.toLowerCase()]));
  // Artikel nur vor Zeiteinheiten / "uhr" als Zahl werten
  t = t.replace(rx('\\b<(ein|eine|einen|einem|einer)\\s+(?=(minute|minuten|stunde|stunden|tag|tage|tagen|woche|wochen|monat|monate|monaten|jahr|jahre|jahren|uhr|halbe[n]?\\s+stunde|viertelstunde)\\b>)'), '1 ');
  t = t.replace(rx('\\b<(eine[rn]?\\s+)?halbe[n]?\\s+stunde\\b>'), '30 minuten');
  t = t.replace(rx('\\b<(eine[rn]?\\s+)?viertelstunde\\b>'), '15 minuten');
  t = t.replace(rx('\\b<(eine[rn]?\\s+)?dreiviertelstunde\\b>'), '45 minuten');
  t = t.replace(rx('\\b<anderthalb\\s+stunden\\b>'), '90 minuten');
  return t;
}

/**
 * Kleiner Helfer, der Treffer aus dem Text "herausschneidet".
 * Alles, was übrig bleibt, wird zum Titel.
 */
class Cutter {
  constructor(text) { this.text = text; }
  take(re, fn) {
    const m = this.text.match(re);
    if (!m) return null;
    const res = fn ? fn(m) : m;
    if (res === false) return null; // fn darf Treffer ablehnen
    this.text = (this.text.slice(0, m.index) + ' ' + this.text.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ');
    return res === undefined ? m : res;
  }
  has(re) { return re.test(this.text); }
}

const PERIOD = {
  frueh: { from: 0, def: '08:00' }, morgens: { from: 0, def: '08:00' }, vormittags: { from: 0, def: '10:00' },
  mittags: { from: 11, def: '12:00' }, nachmittags: { from: 12, def: '15:00' }, abends: { from: 12, def: '19:00' }, nachts: { from: 18, def: '22:00' },
};
function periodKey(w) {
  w = w.toLowerCase();
  if (w.startsWith('früh') || w.startsWith('frueh')) return 'frueh';
  if (w.startsWith('vormittag')) return 'vormittags';
  if (w.startsWith('nachmittag')) return 'nachmittags';
  if (w.startsWith('mittag')) return 'mittags';
  if (w.startsWith('abend')) return 'abends';
  if (w.startsWith('nacht')) return 'nachts';
  if (w.startsWith('morgen')) return 'morgens';
  return null;
}

function applyPeriod(h, period) {
  if (!period) return h <= 6 && h >= 1 ? h + 12 : h; // "um 3" meint in einer Familie fast immer 15 Uhr
  if (period === 'frueh' || period === 'morgens' || period === 'vormittags') return h === 12 ? 0 : h;
  if (period === 'mittags') return h < 6 ? h + 12 : h;
  if (period === 'nachts') return h >= 1 && h <= 4 ? h : h < 12 ? h + 12 : h;
  return h < 12 ? h + 12 : h; // nachmittags, abends
}

function nextWeekday(now, wd, forceNext) {
  const today = now.getDay();
  let diff = (wd - today + 7) % 7;
  if (forceNext && diff === 0) diff = 7;
  return addDays(now, diff);
}

// Einkauf: Einordnung über den Artikelkatalog (catalog.js)
export function shoppingCategory(name) { return categoryOf(name); }
export const SHOPPING_CATEGORY_ORDER = CATEGORY_ORDER;

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function cleanTitle(s) {
  let t = s;
  const fillers = [
    '\\b<(bitte|mal|doch|noch|eben|kurz|auch|dann)\\b>',
    '^\\s*(hey|ok|okay|also|ähm|äh)\\b>',
    '\\b<(trag(e)?|schreib(e)?|setz(e)?|notier(e)?|plane?|füg(e)?|leg(e)?)\\s+(mir\\s+|uns\\s+)?',
    '\\b<(ein(tragen)?|hinzu(fügen)?|an(legen)?|auf(schreiben)?|notieren|eintragen|hinzufügen|anlegen|aufschreiben|planen|speichern)\\s*[.!]?\\s*$',
    '^\\s*(ich\\s+(habe|hab)|wir\\s+haben|es\\s+gibt|da\\s+ist)\\b>',
    '^\\s*(herzliche\\s+)?einladung\\s+(zu[mr]?|für\\s+(den|die|das))\\s+',
    '^\\s*(erinnerung|reminder)\\s*[:,-]\\s*',
    '\\b<(habe|hab|haben)\\s*$',
    '^\\s*(muss|müssen|soll|sollte|sollen|kann|könnte)\\s+(noch\\s+)?',
    '^\\s*(neue[rns]?|einen|eine|ein)\\s+(termin|aufgabe|todo|to-do|eintrag)\\b>',
    '^\\s*(termin|aufgabe|todo|to-do|eintrag)\\s*[:,-]?',
    '\\b<(in\\s+den|im|in\\s+meinen|in\\s+unseren)\\s+kalender\\b>',
    '\\b<(auf\\s+die|zur|zu\\s+den)\\s+(aufgaben(liste)?|todo-?liste)\\b>',
    '\\b<(dass|daran,?\\s+dass|daran)\\b>',
  ];
  for (let i = 0; i < 2; i++) for (const f of fillers) t = t.replace(rx(f), ' ');
  t = t.replace(/\s+([,.!?])/g, '$1').replace(/^[\s,.:;!?-]+|[\s,.:;-]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  t = t.replace(rx('^(am|um|im|mit|für|von|bis|und|der|die|das|den|dem|zum|zur)\\b>\\s*'), '').replace(rx('\\s*\\b<(am|um|im|mit|für|von|bis|und|zum|zur)$'), '').trim();
  t = t.replace(/^(einen|eine|ein)\s+/i, '');
  return capitalize(t);
}

function splitItems(s) {
  return s
    .split(rx('\\s*(?:,|;|\\bund\\b>|\\bsowie\\b>|\\bplus\\b>|\\baußerdem\\b>)\\s*'))
    .map((x) => cleanTitle((x || '').replace(rx('^(noch|neue[sn]?|etwas|ein\\s+paar|paar)\\s+'), '')))
    .filter((x) => x && x.length > 1);
}

/**
 * @param {string} input   gesprochener oder getippter Text
 * @param {object} opts    { now: Date, members: [{id,name,aliases?}], meId?: string }
 */
export function parse(input, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const members = opts.members || [];
  const out = {
    kind: null, title: '', date: null, time: null, endTime: null, allDay: false, durationMin: null,
    repeat: null, remindMin: null, priority: false, memberIds: [], items: [], notes: [], source: input,
  };
  if (!input || !input.trim()) return { ...out, kind: 'task' };

  let text = ' ' + wordsToNumbers(input.trim().replace(/[„“"]/g, '')) + ' ';
  const c = new Cutter(text);
  let explicitKind = null;
  let period = null;
  let datePeriodHint = null;

  // ---------- Art des Eintrags ----------
  if (c.take(rx('\\b<(?:(?:setz(?:e)?|schreib(?:e)?|pack(?:e)?|tu(?:e)?)\\s+)?(?:\\S+\\s+){0,6}?(?:auf\\s+die|zur|in\\s+die|auf\\s+unsere|auf\\s+meine)\\s+einkaufs?liste\\b>'), (m) => {
    // nur den Listen-Teil entfernen, die Artikel davor behalten
    const inner = m[0].replace(rx('^\\s*(?:setz(?:e)?|schreib(?:e)?|pack(?:e)?|tu(?:e)?)\\s+'), '').replace(rx('(?:auf\\s+die|zur|in\\s+die|auf\\s+unsere|auf\\s+meine)\\s+einkaufs?liste\\b>'), '');
    c._keep = inner;
  })) {
    explicitKind = 'shopping';
    if (c._keep) c.text = c._keep + ' ' + c.text;
  } else if (c.take(rx('^\\s*(?:einkaufs?liste|einkauf|einkaufen)\\s*[:,-]?'))) explicitKind = 'shopping';
  else if (c.take(rx('^\\s*(?:wir\\s+)?(?:brauchen|benötigen)\\s+(?:noch\\s+)?'))) explicitKind = 'shopping';
  else if (c.take(rx('^\\s*(?:bitte\\s+)?(?:kaufe?n?|besorg(?:e|en)?|hol(?:e|en)?)\\s+'))) explicitKind = 'shopping';
  else if (c.take(rx('\\s(?:muss|müssen|sollten|sollen)\\s+(?:wir\\s+|ich\\s+)?(?:noch\\s+)?(?:kaufen|besorgen|holen)\\s*$'))) explicitKind = 'shopping';
  else if (c.take(rx('\\s(?:kaufen|besorgen)\\s*$'))) explicitKind = 'shopping';

  // ---------- Essensplan ----------
  if (!explicitKind) {
    const slotOf = (w) => (/früh/i.test(w) ? 'breakfast' : /mittag/i.test(w) ? 'lunch' : 'dinner');
    const mealRe = rx('\\b<(?:zum|als|fürs|zu[mr]?)\\s+(frühstück|mittagessen|mittag|abendessen|abendbrot|essen)\\b>');
    const cue = rx('\\b<(?:gibt\\s+es|gibt\'s|gibts|essen\\s+wir|kochen\\s+wir|koche\\s+ich|machen\\s+wir)\\b>');
    const head = rx('^\\s*(frühstück|mittagessen|abendessen|abendbrot)\\s*[:,-]?');
    const plan = rx('\\b<(?:auf\\s+den|in\\s+den|zum)\\s+essensplan\\b>');
    if (c.has(cue) || c.has(head) || c.has(plan)) {
      explicitKind = 'meal';
      out.slot = 'dinner';
      c.take(mealRe, (m) => { out.slot = slotOf(m[1]); });
      c.take(head, (m) => { out.slot = slotOf(m[1]); });
      c.take(cue); c.take(plan);
      c.take(rx('\\b<(mittags|abends|morgens|zum\\s+mittag|am\\s+abend)\\b>'), (m) => { out.slot = slotOf(m[1]); });
    }
  }

  if (!explicitKind) {
    if (c.take(rx('^\\s*(?:neue[rn]?\\s+)?(?:aufgabe|todo|to-do|erledigen)\\s*[:,-]?'))) explicitKind = 'task';
    else if (c.take(rx('^\\s*(?:neue[rn]?\\s+)?termin\\s*[:,-]?'))) explicitKind = 'event';
    else if (c.has(rx('\\b<(?:termin|verabredung|treffen|meeting|besprechung|arzttermin|elternabend|geburtstag|feier|party)\\b>'))) explicitKind = 'event';
  }

  // ---------- Erinnerung ----------
  let remindExplicit = false;
  c.take(rx('\\b<(?:und\\s+)?(?:erinnere?|erinner)\\s+(?:mich|uns)\\s+(\\d+)\\s*(minuten?|min|stunden?|std|tage?n?)\\s+(?:vorher|davor|früher|zuvor)\\b>'), (m) => {
    const n = +m[1]; const u = m[2].toLowerCase();
    out.remindMin = u.startsWith('st') ? n * 60 : u.startsWith('t') ? n * 1440 : n;
    remindExplicit = true;
  });
  c.take(rx('\\b<(?:und\\s+)?(?:mit\\s+)?erinnerung\\b>'), () => { if (out.remindMin == null) out.remindMin = 30; remindExplicit = true; });
  c.take(rx('^\\s*(?:bitte\\s+)?(?:erinnere?|erinner)\\s+(?:mich|uns)\\s*(?:bitte\\s+)?(?:daran,?\\s*)?(?:dass\\s+)?'), () => {
    if (!explicitKind) explicitKind = 'task';
    if (out.remindMin == null) out.remindMin = 0;
    remindExplicit = true;
  });
  c.take(rx('\\b<(?:nicht\\s+vergessen|vergiss\\s+nicht|denk(?:e)?\\s+(?:dran|daran))\\b>[:,]?'), () => { if (!explicitKind) explicitKind = 'task'; });

  // ---------- Priorität ----------
  c.take(rx('\\b<(?:ganz\\s+|sehr\\s+)?(?:wichtig|dringend|eilig|asap|priorität)\\b>!?'), () => { out.priority = true; });
  if (/!\s*$/.test(c.text)) out.priority = out.priority || /!!/.test(c.text);

  // ---------- Wiederholung ----------
  const wdNames = WEEKDAYS.join('|');
  c.take(rx(`\\b<(?:jeden|immer\\s+(?:am|montags|dienstags))\\s+(${wdNames})\\b>|\\b<(${wdNames.split('|').map((w) => w + 's').join('|')})\\b>`), (m) => {
    const name = (m[1] || m[2]).toLowerCase().replace(/s$/, '');
    const wd = WEEKDAYS.indexOf(name);
    if (wd < 0) return false;
    out.repeat = { freq: 'weekly', interval: 1 };
    out._weekday = wd;
  });
  c.take(rx('\\b<(?:jeden\\s+tag|täglich|taeglich|jeden\\s+morgen|jeden\\s+abend)\\b>'), (m) => {
    out.repeat = { freq: 'daily', interval: 1 };
    if (/morgen/i.test(m[0])) period = period || 'morgens';
    if (/abend/i.test(m[0])) period = period || 'abends';
  });
  c.take(rx('\\b<(?:werktags|jeden\\s+werktag|montags?\\s+bis\\s+freitags?|unter\\s+der\\s+woche)\\b>'), () => { out.repeat = { freq: 'weekdays', interval: 1 }; });
  c.take(rx('\\b<alle\\s+(\\d+)\\s+(tage|wochen|monate|jahre)\\b>'), (m) => {
    const u = m[2].toLowerCase();
    out.repeat = { freq: u.startsWith('t') ? 'daily' : u.startsWith('w') ? 'weekly' : u.startsWith('m') ? 'monthly' : 'yearly', interval: +m[1] };
  });
  c.take(rx('\\b<(?:jede\\s+woche|wöchentlich|woechentlich|einmal\\s+die\\s+woche)\\b>'), () => { out.repeat = { freq: 'weekly', interval: 1 }; });
  c.take(rx('\\b<(?:jede\\s+2\\.?\\s+woche|alle\\s+zwei\\s+wochen|zweiwöchentlich|14-tägig|14\\s+tägig)\\b>'), () => { out.repeat = { freq: 'weekly', interval: 2 }; });
  c.take(rx('\\b<(?:jeden\\s+monat|monatlich|einmal\\s+im\\s+monat)\\b>'), () => { out.repeat = { freq: 'monthly', interval: 1 }; });
  c.take(rx('\\b<(?:jedes\\s+jahr|jährlich|jaehrlich|einmal\\s+im\\s+jahr)\\b>'), () => { out.repeat = { freq: 'yearly', interval: 1 }; });

  // ---------- Datum ----------
  let date = null;
  const monthNames = [...MONTHS, 'maerz', ...Object.keys(MONTH_ALIASES)].sort((a, b) => b.length - a.length).join('|');
  const monthIndex = (s) => { s = s.toLowerCase().replace(/\.$/, ''); const i = MONTHS.indexOf(s); if (i >= 0) return i; if (s === 'maerz') return 2; return MONTH_ALIASES[s] ?? -1; };
  const fixYear = (y, m, d, explicitYear) => {
    let dt = new Date(y, m, d);
    if (!explicitYear && dt < startOfDay(now)) dt = new Date(y + 1, m, d);
    return dt;
  };

  // 24.12. / 24.12.2026 / am 3.1.
  c.take(rx('\\b<(?:am\\s+|bis\\s+(?:zum\\s+)?|zum\\s+)?(\\d{1,2})\\.\\s?(\\d{1,2})\\.(?:\\s?(\\d{2,4}))?(?!\\d)(?!\\s*uhr)'), (m) => {
    const d = +m[1]; const mo = +m[2] - 1; if (d < 1 || d > 31 || mo < 0 || mo > 11) return false;
    let y = m[3] ? +m[3] : now.getFullYear(); if (y < 100) y += 2000;
    date = fixYear(y, mo, d, !!m[3]);
  });
  // 3. März / am dritten März / 3 märz 2027
  if (!date) c.take(rx(`\\b<(?:am\\s+|bis\\s+(?:zum\\s+)?|zum\\s+)?(\\d{1,2})\\.?\\s*(${monthNames})\\.?(?:\\s+(\\d{4}))?\\b>`), (m) => {
    const mo = monthIndex(m[2]); if (mo < 0) return false;
    const d = +m[1]; if (d < 1 || d > 31) return false;
    date = fixYear(m[3] ? +m[3] : now.getFullYear(), mo, d, !!m[3]);
  });
  // heute / morgen / übermorgen  (aber "morgen früh" vs. "heute morgen")
  if (!date) c.take(rx('\\b<(heute|übermorgen|uebermorgen|morgen)(?:\\s+(früh|frueh|morgen|vormittag|mittag|nachmittag|abend|nacht))?\\b>'), (m) => {
    const w = m[1].toLowerCase();
    // "morgens" darf nicht als "morgen" erkannt werden – \b> verhindert das bereits
    date = addDays(now, w === 'heute' ? 0 : w === 'morgen' ? 1 : 2);
    if (m[2]) datePeriodHint = periodKey(m[2]);
  });
  // (am) (nächsten|kommenden|diesen) Montag
  if (!date && out._weekday == null) c.take(rx(`\\b<(?:am\\s+|ab\\s+|bis\\s+)?(nächsten|naechsten|nächster|kommenden|diesen|diesem|übernächsten)?\\s*(${wdNames})(?:\\s+(früh|morgen|vormittag|mittag|nachmittag|abend|nacht))?\\b>`), (m) => {
    const wd = WEEKDAYS.indexOf(m[2].toLowerCase());
    const mod = (m[1] || '').toLowerCase();
    date = nextWeekday(now, wd, !!mod && mod !== 'diesen' && mod !== 'diesem');
    if (mod.startsWith('über')) date = addDays(date, 7);
    if (m[3]) datePeriodHint = periodKey(m[3]);
  });
  if (!date && out._weekday != null) date = nextWeekday(now, out._weekday, false);
  // in 3 Tagen / in 2 Wochen / in einem Monat
  if (!date) c.take(rx('\\b<in\\s+(\\d+)\\s+(tag(?:en)?|woche[n]?|monat(?:en)?|jahr(?:en)?)\\b>'), (m) => {
    const n = +m[1]; const u = m[2].toLowerCase();
    if (u.startsWith('tag')) date = addDays(now, n);
    else if (u.startsWith('woche')) date = addDays(now, 7 * n);
    else if (u.startsWith('monat')) date = new Date(now.getFullYear(), now.getMonth() + n, now.getDate());
    else date = new Date(now.getFullYear() + n, now.getMonth(), now.getDate());
  });
  if (!date) c.take(rx('\\b<(?:am\\s+|übers\\s+|über\\s+das\\s+|dieses\\s+|nächstes\\s+|kommendes\\s+)?wochenende\\b>'), (m) => {
    date = nextWeekday(now, 6, /nächstes|kommendes/i.test(m[0]) && now.getDay() !== 6 ? false : false);
    if (now.getDay() === 0) date = startOfDay(now);
  });
  if (!date) c.take(rx('\\b<(?:bis\\s+)?ende\\s+(?:der|dieser)\\s+woche\\b>'), () => { date = nextWeekday(now, 5, false); });
  if (!date) c.take(rx('\\b<(übernächste|nächste|kommende)\\s+woche\\b>'), (m) => {
    date = addDays(nextWeekday(now, 1, true), m[1].toLowerCase().startsWith('über') ? 7 : 0);
    out.notes.push('Woche');
  });
  if (!date) c.take(rx('\\b<(nächsten|kommenden)\\s+monat\\b>'), () => { date = new Date(now.getFullYear(), now.getMonth() + 1, 1); out.notes.push('Monat'); });
  if (!date) c.take(rx('\\b<ende\\s+(?:des\\s+)?(?:monats|dieses\\s+monats)\\b>'), () => { date = new Date(now.getFullYear(), now.getMonth() + 1, 0); });

  // ---------- Uhrzeit ----------
  let time = null; let endTime = null;
  const setTime = (h, mi) => { if (h > 24 || mi > 59) return null; return `${pad(h % 24)}:${pad(mi)}`; };
  const pendingHours = []; // [hour, minute, explicit24h]

  // Zeiträume: von 14 bis 16 Uhr / 14-16 Uhr / von 9:30 bis 11
  c.take(rx('\\b<(?:von\\s+|zwischen\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:uhr\\s*)?(?:bis|-|–|und)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*uhr\\b>|\\b<von\\s+(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:uhr\\s*)?bis\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\b>'), (m) => {
    const a = m[1] ? [m[1], m[2], m[3], m[4]] : [m[5], m[6], m[7], m[8]];
    pendingHours.push([+a[0], +(a[1] || 0), !!a[1] || +a[0] > 12]);
    pendingHours.push([+a[2], +(a[3] || 0), !!a[3] || +a[2] > 12]);
  });
  // halb 3, viertel nach 8, viertel vor 9, dreiviertel 4, 10 nach 5, 5 vor halb 4
  if (!pendingHours.length) c.take(rx('\\b<(?:um\\s+|gegen\\s+|ab\\s+)?(?:(\\d{1,2})\\s+(vor|nach)\\s+halb|(viertel|\\d{1,2})\\s+(nach|vor)|(dreiviertel|halb))\\s+(\\d{1,2})(?:\\s*uhr)?\\b>'), (m) => {
    let h = +m[6]; let mi = 0;
    if (m[1]) { h -= 1; mi = 30 + (m[2].toLowerCase() === 'nach' ? +m[1] : -+m[1]); }
    else if (m[3]) { const n = m[3].toLowerCase() === 'viertel' ? 15 : +m[3]; if (m[4].toLowerCase() === 'nach') mi = n; else { h -= 1; mi = 60 - n; } }
    else if (m[5].toLowerCase() === 'halb') { h -= 1; mi = 30; }
    else { h -= 1; mi = 45; }
    if (h < 0) h += 12;
    pendingHours.push([h === 0 ? 12 : h, mi, false]);
  });
  // um 15:30 / 15.30 Uhr / 15 Uhr 30 / um 8 / 8 Uhr
  if (!pendingHours.length) c.take(rx('\\b<(?:um|gegen|ab|bis|spätestens\\s+um)\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*uhr(?:\\s+(\\d{1,2}))?)?\\b>|\\b<(\\d{1,2})(?:[:.](\\d{2}))?\\s*uhr(?:\\s+(\\d{1,2})(?!\\s*(?:minuten|min|tage|stunden)))?\\b>|\\b<(\\d{1,2})[:](\\d{2})\\b>'), (m) => {
    const h = +(m[1] ?? m[4] ?? m[7]); const mi = +(m[2] ?? m[3] ?? m[5] ?? m[6] ?? m[8] ?? 0);
    if (h > 24) return false;
    pendingHours.push([h, mi, !!(m[2] || m[5] || m[8]) || h > 12 || h === 0]);
  });

  // Tageszeit-Wörter ("abends", "am Nachmittag", "früh")
  c.take(rx('\\b<(?:am\\s+|in\\s+der\\s+)?(morgens|früh|frueh|vormittags?|mittags?|nachmittags?|abends?|nachts?)\\b>'), (m) => {
    // "morgen" ohne s wurde oben schon als Datum verarbeitet
    period = periodKey(m[1]);
  });
  period = period || datePeriodHint;

  if (pendingHours.length) {
    const [h1, m1, abs1] = pendingHours[0];
    const H1 = abs1 ? h1 : applyPeriod(h1, period);
    time = setTime(H1, m1);
    if (pendingHours[1]) {
      const [h2, m2, abs2] = pendingHours[1];
      let H2 = abs2 ? h2 : applyPeriod(h2, period);
      if (!abs2 && H2 < H1 && H2 + 12 <= 24) H2 += 12;
      endTime = setTime(H2, m2);
    }
  } else if (period && (explicitKind === 'event' || date)) {
    time = PERIOD[period].def;
    out.notes.push('ungefähre Uhrzeit');
  }

  // Dauer: für 2 Stunden / 90 Minuten lang
  c.take(rx('\\b<(?:für|ca\\.?|etwa|ungefähr)?\\s*(\\d+(?:[,.]5)?)\\s*(stunden?|std|minuten|min)\\s*(?:lang)?\\b>'), (m) => {
    const n = parseFloat(m[1].replace(',', '.')); const u = m[2].toLowerCase();
    out.durationMin = Math.round(u.startsWith('st') ? n * 60 : n);
  });
  c.take(rx('\\b<den\\s+ganzen\\s+tag|ganztägig|ganztags\\b>'), () => { out.allDay = true; });

  // "in 2 Stunden" / "in 30 Minuten" (relativ zur aktuellen Zeit) – erst nach der Dauer, um "für 2 Stunden" nicht zu verwechseln
  c.take(rx('\\b<in\\s+(\\d+)\\s*(minuten|min|stunden?|std)\\b>'), (m) => {
    const n = +m[1]; const u = m[2].toLowerCase();
    const at = new Date(now.getTime() + (u.startsWith('st') ? n * 60 : n) * 60000);
    date = startOfDay(at); time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  });
  if (out.durationMin && /in\s*$/i.test(c.text)) c.text = c.text.replace(/in\s*$/i, ' ');

  // ---------- Personen ----------
  const ids = new Set();
  c.take(rx('\\b<(?:für\\s+|mit\\s+)?(?:allen|alle|die\\s+ganze\\s+familie|der\\s+ganzen\\s+familie|uns\\s+alle|familie)\\b>'), (m) => {
    if (!members.length) return false;
    if (/^\s*familie\s*$/i.test(m[0]) && !/für|mit/i.test(m[0])) return false;
    members.forEach((mb) => ids.add(mb.id));
  });
  for (const mb of members) {
    const names = [mb.name, ...(mb.aliases || [])].filter(Boolean).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!names.length) continue;
    const re = rx(`\\b<(?:(?:für|mit|von|bei|zu)\\s+)?(?:(?:der|die|den|dem|unsere[mnr]?|meine[mnr]?)\\s+)?(?:${names.join('|')})(?:s)?\\b>`);
    while (c.take(re, () => { ids.add(mb.id); })) { /* alle Vorkommen entfernen */ }
  }
  if (opts.meId && c.take(rx('\\b<(?:für\\s+mich|ich\\s+muss|muss\\s+ich)\\b>'))) ids.add(opts.meId);
  out.memberIds = [...ids];

  // ---------- Ergebnis ----------
  if (date) out.date = ymd(date);
  if (time) out.time = time;
  if (endTime) out.endTime = endTime;
  if (out.time && !out.endTime && out.durationMin) {
    const [h, mi] = out.time.split(':').map(Number);
    const t = h * 60 + mi + out.durationMin;
    out.endTime = `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
  }
  if (out.repeat && !out.date) out.date = ymd(now);

  let rest = c.text;
  let kind = explicitKind;
  if (!kind) {
    const restClean = cleanTitle(rest);
    const lastWord = (restClean.split(/\s+/).pop() || '');
    const looksLikeTodo = /^[a-zäöüß]+(?:en|ern|eln)$/.test(lastWord) && !/^ge[a-zäöüß]{4,}en$/.test(lastWord) && !/^(?:allen|denen|einen|keinen|ihnen|unseren|meinen)$/.test(lastWord) && restClean.split(/\s+/).length >= 2 && !/^[A-ZÄÖÜ]/.test(lastWord);
    const eventWords = rx('\\b<(arzt|zahnarzt|kinderarzt|frisör|friseur|training|schwimmen|fußball|turnen|kita|schule|kindergarten|elternabend|geburtstag|hochzeit|urlaub|ferien|reise|flug|kino|theater|konzert|essen|abendessen|frühstück|brunch|besuch|treffen|probe|unterricht|kurs|nachhilfe|abholen|bringen)\\b>');
    if (out.time && !(looksLikeTodo && !eventWords.test(restClean))) kind = 'event';
    else if (out.date && eventWords.test(restClean) && !/(?:rausbringen|packen|kaufen|bezahlen|machen|erledigen)$/.test(lastWord)) kind = 'event';
    else if (looksLikeTodo) kind = 'task';
    else if (out.date) kind = out.repeat ? 'task' : 'event';
    else kind = 'task';
  }
  if (kind === 'event' && /geburtstag/i.test(rest) && !out.time) { out.allDay = true; if (!out.repeat) out.repeat = { freq: 'yearly', interval: 1 }; }
  if (kind === 'event' && !out.time) out.allDay = true;
  if (kind === 'event' && !out.date) out.date = ymd(now);
  if (kind === 'task' && out.remindMin === 0 && !out.time) {
    out.time = out.date ? '09:00' : null;
  }
  if (kind === 'event' && !remindExplicit) out.remindMin = null;

  out.kind = kind;
  if (kind === 'meal') {
    out.title = cleanTitle(rest).replace(/^(es|wir)\s+/i, '') || 'Essen';
    out.title = out.title.charAt(0).toUpperCase() + out.title.slice(1);
    out.date = out.date || ymd(now); out.time = null; out.endTime = null; out.allDay = false; out.repeat = null; out.remindMin = null;
    delete out._weekday;
    return out;
  }
  if (kind === 'shopping') {
    out.items = splitItems(rest).map((name) => ({ name, category: shoppingCategory(name) }));
    out.title = out.items.map((i) => i.name).join(', ');
    out.date = null; out.time = null; out.endTime = null; out.allDay = false; out.repeat = null;
  } else {
    out.title = cleanTitle(rest) || (kind === 'event' ? 'Termin' : 'Aufgabe');
  }
  delete out._weekday;
  return out;
}

/** Menschlich lesbare Zusammenfassung, z. B. für die Bestätigung per Sprachausgabe. */
export function describe(p, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const memberNames = (opts.members || []).filter((m) => p.memberIds?.includes(m.id)).map((m) => m.name);
  if (p.kind === 'meal') return `${p.title} ${relativeDay(p.date, now)} ${({ breakfast: 'zum Frühstück', lunch: 'zum Mittag', dinner: 'zum Abendessen' })[p.slot] || ''} im Essensplan`;
  if (p.kind === 'shopping') return `${p.items.length === 1 ? p.items[0].name : p.items.length + ' Artikel'} auf die Einkaufsliste`;
  const parts = [p.kind === 'event' ? 'Termin' : 'Aufgabe', `„${p.title}“`];
  if (p.date) parts.push(relativeDay(p.date, now));
  if (p.time) parts.push(`um ${p.time.replace(/^0/, '')} Uhr`);
  if (memberNames.length) parts.push(`für ${joinNames(memberNames)}`);
  if (p.repeat) parts.push(repeatLabel(p.repeat).toLowerCase());
  return parts.join(' ');
}

export function joinNames(n) { return n.length <= 1 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' und ' + n[n.length - 1]; }

export function relativeDay(dateStr, now = new Date()) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const diff = Math.round((dt - startOfDay(now)) / 86400000);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  if (diff === 2) return 'übermorgen';
  if (diff === -1) return 'gestern';
  const wd = WEEKDAYS[dt.getDay()];
  const cap = wd.charAt(0).toUpperCase() + wd.slice(1);
  if (diff > 2 && diff < 7) return `am ${cap}`;
  return `am ${cap}, ${d}. ${MONTHS[m - 1].charAt(0).toUpperCase() + MONTHS[m - 1].slice(1)}${y !== now.getFullYear() ? ' ' + y : ''}`;
}

export function repeatLabel(r) {
  if (!r) return '';
  const n = r.interval || 1;
  switch (r.freq) {
    case 'daily': return n === 1 ? 'Täglich' : `Alle ${n} Tage`;
    case 'weekdays': return 'Werktags';
    case 'weekly': return n === 1 ? 'Wöchentlich' : `Alle ${n} Wochen`;
    case 'monthly': return n === 1 ? 'Monatlich' : `Alle ${n} Monate`;
    case 'yearly': return n === 1 ? 'Jährlich' : `Alle ${n} Jahre`;
    default: return '';
  }
}

export { WEEKDAYS, MONTHS };
