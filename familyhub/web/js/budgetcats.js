// Kategorien des Haushaltsbuchs (rein, ohne Oberfläche – auch vom Server genutzt)
export const CATEGORIES = [
  ['Lebensmittel', '🛒', /lebensmittel|supermarkt|einkauf|edeka|rewe|aldi|lidl|penny|netto|kaufland|bäcker|metzger|wochenmarkt/i],
  ['Haushalt', '🏠', /haushalt|drogerie|dm\b|rossmann|putz|möbel|ikea|baumarkt/i],
  ['Kinder', '🧒', /kind|kita|schule|spielzeug|windel|ausflug|klassenfahrt|nachhilfe|taschengeld/i],
  ['Kleidung', '👕', /kleid|schuh|jacke|hose|mode|zalando/i],
  ['Mobilität', '🚗', /tank|benzin|diesel|auto|werkstatt|bahn|bus|ticket|parken|fahrrad/i],
  ['Gesundheit', '💊', /arzt|apotheke|medikament|brille|zahn|physio/i],
  ['Freizeit', '🎡', /restaurant|essen gehen|pizza|kino|eis|freizeit|urlaub|hobby|verein|schwimm|zoo/i],
  ['Wohnen & Verträge', '📄', /miete|strom|gas|internet|handy|versicherung|vertrag|abo|rundfunk|gez|nebenkosten/i],
  ['Geschenke', '🎁', /geschenk|geburtstag|weihnacht/i],
  ['Sonstiges', '💶', /.*/],
];
export const INCOME = [['Gehalt', '💼'], ['Kindergeld', '🧒'], ['Sonstige Einnahme', '💶']];
export function guessCategory(text) { for (const [c, , re] of CATEGORIES) if (re.test(text)) return c; return 'Sonstiges'; }
