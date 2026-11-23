// Abfallarten & Hilfsfunktionen (rein, ohne Oberfläche – auch von Sprache und Kalender genutzt)
export const WASTE_TYPES = [
  ['rest', 'Restmüll', '⚫', '#4B5563', /rest|grau|hausmüll|schwarz/i],
  ['bio', 'Biotonne', '🟤', '#8B5A2B', /bio|braun|kompost|organ/i],
  ['gelb', 'Gelber Sack / Tonne', '🟡', '#E0B400', /gelb|wertstoff|verpackung|lvp|plastik|leichtverpack/i],
  ['papier', 'Papier', '🔵', '#2563EB', /papier|pappe|blau|karton|ppk/i],
  ['glas', 'Glas', '🟢', '#16A34A', /glas/i],
  ['gruen', 'Grünschnitt', '🌿', '#65A30D', /grün|gruen|garten|baum|laub|strauch/i],
  ['sperr', 'Sperrmüll', '🛋️', '#9333EA', /sperr/i],
  ['schadstoff', 'Schadstoffe', '☣️', '#DC2626', /schadstoff|sonderm|problemst/i],
  ['other', 'Sonstiges', '🗑️', '#6B7280', /.*/],
];
export const byKey = Object.fromEntries(WASTE_TYPES.map((t) => [t[0], t]));
export function wasteType(title) { for (const t of WASTE_TYPES) if (t[4].test(title || '')) return t; return byKey.other; }
export const WASTE_RE = /müll|tonne|abfall|wertstoff|gelber sack|gelbe tonne|papier|altpapier|bio(tonne|müll|abfall)|sperrmüll|schadstoff|grünschnitt|leerung|abfuhr/i;

/** Google-Einbettungslink → öffentliche iCal-Adresse */
export function normalizeWasteUrl(u) {
  u = String(u || '').trim().replace(/^webcal:\/\//i, 'https://');
  // nur die Kalender-ID (z. B. abc123@import.calendar.google.com oder …@group.calendar.google.com)
  if (/^[^\s/@]+@([a-z]+\.)?calendar\.google\.com$/i.test(u) || /^[^\s/@]+@gmail\.com$/i.test(u)) return `https://calendar.google.com/calendar/ical/${encodeURIComponent(u)}/public/basic.ics`;
  const m = u.match(/calendar\.google\.com\/calendar\/(?:u\/\d+\/)?embed\?(?:.*&)?src=([^&]+)/i);
  if (m) return `https://calendar.google.com/calendar/ical/${encodeURIComponent(decodeURIComponent(m[1]))}/public/basic.ics`;
  return u;
}
