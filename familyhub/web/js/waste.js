// Abfall: Abholtermine (Restmüll, Bio, Gelber Sack, Papier …) aus einem Abfuhrkalender.
// Quelle: Abo-Link (iCal/ICS) des Entsorgers oder Google-Kalender, alternativ eine .ics-Datei.
// Termine erscheinen im Kalender, auf „Heute“, im Widget, in der Wandansicht und als Erinnerung am Vorabend.
import { h, icon, toast, sheet, confirmSheet, fmt } from './ui.js';
import { store } from './store.js';
import { agenda, members, member, today, childMode } from './domain.js';
import { ymd, addDays } from './nlp.js';
import { parseIcs } from './icsparse.js';
import { refreshCalendar, calStatus } from './extcal.js';
import { pickFile } from './native.js';

import { WASTE_TYPES, byKey, wasteType, WASTE_RE, normalizeWasteUrl } from './wastetypes.js';
export { WASTE_TYPES, wasteType, normalizeWasteUrl };
export const DEFAULT_WASTE_SOURCE = 'https://calendar.google.com/calendar/embed?src=ar8puv20of046lkk41d6h889asdiuhf2%40import.calendar.google.com&ctz=Europe%2FBerlin';

export function wasteCalendar() { return store.list('calendars').filter((c) => c.kind === 'waste').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null; }

/** Alle Abholtermine zwischen from und to: aus dem Abfall-Kalender, importierten Dateien oder passend benannten Terminen. */
export function pickups(from, to) {
  const cal = wasteCalendar();
  return agenda(from, to, { filter: false })
    .filter((e) => e.waste || (cal && e.external === cal.id.slice(0, 10)) || (e.readOnly && WASTE_RE.test(e.title)))
    .map((e) => { const t = wasteType(e.title); return { ...e, wasteKey: t[0], wasteName: t[1], wasteEmoji: t[2], wasteColor: t[3] }; });
}
/** Für Sprache, Widget, Heute: was wird morgen (bzw. heute) abgeholt? */
export function pickupsOn(date) { return pickups(date, date); }
export function dutyFor(key) { const d = wasteCalendar()?.duties?.[key]; return d ? member(d) : null; }

// ================= Ansicht =================
export function viewWaste() {
  const page = h('div.page');
  const cal = wasteCalendar();
  const td = today();
  const list = pickups(td, ymd(addDays(new Date(), 70)));
  page.append(h('div.page-head', null, h('a.icon-btn', { href: '#mehr', 'aria-label': 'Zurück' }, icon('left')), h('h1', null, 'Abfall'),
    childMode() ? null : h('button.icon-btn', { 'aria-label': 'Abfallkalender einrichten', onclick: () => setup() }, icon('settings'))));

  if (!cal && !list.length) {
    page.append(h('div.card.tip', null, h('b', null, '🗑️ Nie wieder die Tonne verpassen'),
      h('p', null, 'Verbinde euren Abfuhrkalender. FamilyHub zeigt dann, welche Tonne als Nächstes dran ist, erinnert am Vorabend und trägt alle Abholtage in den Kalender ein.'),
      childMode() ? null : h('button.btn.primary', { onclick: () => setup() }, icon('link', 18), 'Abfallkalender verbinden')));
    return page;
  }
  const st = cal ? calStatus(cal.id) : null;
  if (cal && st?.error) page.append(h('div.card.warn-card', null, h('b', null, '⚠ Abfallkalender konnte nicht geladen werden'), h('p.muted', null, st.error), childMode() ? null : h('button.btn.tonal', { onclick: () => setup() }, 'Quelle prüfen')));

  // Nächste Abholung je Tonne
  const next = {};
  for (const p of list) if (!next[p.wasteKey]) next[p.wasteKey] = p;
  const order = Object.values(next).sort((a, b) => a.date.localeCompare(b.date));
  if (order.length) {
    page.append(h('div.bins', null, ...order.map((p) => {
      const diff = fmt.dayDiff(p.date); const duty = dutyFor(p.wasteKey);
      return h('button.bin' + (diff <= 1 ? '.soon' : ''), { style: { '--c': p.wasteColor }, onclick: () => !childMode() && editDuty(p.wasteKey) },
        h('span.bin-emoji', null, p.wasteEmoji),
        h('b', null, p.wasteName),
        h('span.bin-when', null, diff === 0 ? 'heute' : diff === 1 ? 'morgen' : fmt.dayLabel(p.date)),
        h('small', null, diff > 1 ? `in ${diff} Tagen` : diff === 1 ? 'heute Abend rausstellen' : 'jetzt rausstellen'),
        duty ? h('small.bin-duty', null, `${duty.emoji || '👤'} ${duty.name}`) : null);
    })));
  }
  // Liste der nächsten Wochen
  const byDate = {};
  for (const p of list) (byDate[p.date] ||= []).push(p);
  page.append(h('section.section', null, h('h3.section-title', null, 'Nächste Abholtermine'),
    Object.keys(byDate).length ? h('div.menu', null, ...Object.entries(byDate).slice(0, 20).map(([d, ps]) => h('div.menu-row', null,
      h('span.waste-date', null, h('b', null, fmt.parse(d).getDate() + '.'), h('small', null, fmt.WD[fmt.parse(d).getDay()])),
      h('span.mt', null, h('b', null, fmt.dayLabel(d)), h('small', null, ps.map((p) => p.title).join(' · '))),
      h('span.waste-dots', null, ...ps.map((p) => h('span', { title: p.wasteName }, p.wasteEmoji))))))
      : h('p.soft', null, 'In den nächsten Wochen keine Abholtermine gefunden.')));

  const r = reminderCfg();
  page.append(h('section.section', null, h('h3.section-title', null, 'Erinnerung'),
    h('div.menu', null,
      h('label.menu-row.switch-row', null, h('span.mt', null, h('b', null, 'Am Vorabend erinnern'), h('small', null, `„Morgen: 🟡 Gelber Sack – rausstellen“ um ${r.time} Uhr`)),
        h('span.switch', null, h('input', { type: 'checkbox', checked: r.enabled, onchange: (e) => store.saveConfig({ wasteReminder: { ...r, enabled: e.target.checked } }) }), h('span.track'))),
      h('label.menu-row', null, h('span.mt', null, h('b', null, 'Uhrzeit')), h('input.mini-time', { type: 'time', value: r.time, onchange: (e) => store.saveConfig({ wasteReminder: { ...r, time: e.target.value || '19:00' } }) })))),
    h('p.hint', null, 'Tipp: Auf eine Tonne tippen, um festzulegen, wer sie rausstellt – das erscheint dann auch auf „Heute“.'));
  return page;
}

export function reminderCfg() { return { enabled: true, time: '19:00', ...(store.config.wasteReminder || {}) }; }

function editDuty(key) {
  const cal = wasteCalendar(); if (!cal) return;
  const t = byKey[key];
  sheet((s) => h('div.sheet-body', null, h('h2.sheet-title', null, `${t[2]} ${t[1]} – wer stellt raus?`),
    h('div.menu', null,
      ...members().map((m) => h('button.menu-row', { onclick: () => { store.put('calendars', { ...cal, duties: { ...(cal.duties || {}), [key]: m.id } }); s.close(); } }, h('span.av', { style: { '--c': m.color } }, m.emoji || m.name[0]), h('span.mt', null, h('b', null, m.name)), cal.duties?.[key] === m.id ? icon('check') : null)),
      h('button.menu-row', { onclick: () => { const d = { ...(cal.duties || {}) }; delete d[key]; store.put('calendars', { ...cal, duties: d }); s.close(); } }, h('span.mt', null, h('b', null, 'Niemand Bestimmtes'))))), { label: 'Zuständig' });
}

// ================= Einrichtung =================
export function setup() {
  const cal = wasteCalendar();
  let input; const st = h('p.status');
  sheet((s) => h('form.sheet-body', { onsubmit: async (e) => {
    e.preventDefault();
    const url = normalizeWasteUrl(input.value);
    if (!/^https?:\/\//i.test(url)) { st.className = 'status bad'; st.textContent = 'Bitte einen Link (https://… oder webcal://…) einfügen.'; return; }
    const current = wasteCalendar(); // beim erneuten Absenden denselben Kalender aktualisieren
    for (const extra of store.list('calendars').filter((x) => x.kind === 'waste' && x.id !== current?.id)) store.del('calendars', extra.id);
    const saved = store.put('calendars', { ...(current || {}), kind: 'waste', name: 'Abfall', url, color: '#6B7280', memberIds: [], enabled: true, sourceInput: input.value.trim() });
    st.className = 'status'; st.textContent = '◌ Abfuhrkalender wird geladen …';
    const r = await refreshCalendar(saved);
    if (r.error) {
      st.className = 'status bad';
      st.textContent = /401|403|404/.test(r.error) && /google/i.test(url)
        ? '○ Google gibt diesen Kalender nicht frei (er ist nur in deinem Google-Konto sichtbar). Bitte den ursprünglichen Abo-Link deines Entsorgers verwenden oder in Google: Kalendereinstellungen → „Privatadresse im iCal-Format“ kopieren. Alternativ unten eine .ics-Datei importieren.'
        : '○ ' + r.error;
      return;
    }
    const n = r.events.filter((x) => WASTE_RE.test(x.title) || true).length;
    s.close(); toast(`🗑️ ${n} Abholtermine geladen`); location.hash = 'abfall'; window.dispatchEvent(new HashChangeEvent('hashchange'));
  } },
  h('h2.sheet-title', null, 'Abfallkalender verbinden'),
  h('p.muted', null, 'Füge den Kalender-Link ein. Funktioniert mit dem Abo-Link (iCal/ICS) eures Entsorgers, der Abfall-App eurer Stadt oder einem Google-Kalender.'),
  h('label.field', null, h('span', null, 'Kalender-Link'), input = h('textarea', { rows: 3, value: cal?.sourceInput || DEFAULT_WASTE_SOURCE, placeholder: 'https://… .ics  oder  webcal://…' })),
  st,
  h('details', null, h('summary', null, 'Wo finde ich den Link?'), h('ul.tips', null,
    h('li', null, 'Website eures Entsorgers / Landkreises → „Abfuhrkalender“ → Straße wählen → „Kalender abonnieren“ / „iCal“ / „ICS“. Den Link (oft webcal://…) kopieren.'),
    h('li', null, 'Google-Kalender: Kalender → ⋮ → „Einstellungen und Freigabe“ → „Privatadresse im iCal-Format“. Bei Kalendern, die du selbst per URL abonniert hast, gibt es diese Adresse nicht – dann den ursprünglichen Link des Entsorgers nehmen.'),
    h('li', null, 'Nur eine Datei (.ics) heruntergeladen? Dann unten „Datei importieren“.'))),
  h('div.btn-col', null,
    h('button.btn.primary', { type: 'submit' }, icon('link', 18), 'Verbinden'),
    h('button.btn.tonal', { type: 'button', onclick: async () => { s.close(); await importFile(); } }, icon('upload', 18), '.ics-Datei importieren'),
    cal ? h('button.btn.danger-ghost', { type: 'button', onclick: async () => { if (await confirmSheet({ title: 'Abfallkalender trennen?', ok: 'Trennen', danger: true })) { store.del('calendars', cal.id); s.close(); location.hash = 'abfall'; } } }, 'Verbindung trennen') : null)), { tall: true, label: 'Abfallkalender' });
}

/** .ics-Datei einlesen: Termine werden als (synchronisierte) Abfall-Termine gespeichert. */
async function importFile() {
  const txt = await pickFile();
  if (!txt) return;
  if (!/BEGIN:VCALENDAR/.test(txt)) return toast('Das ist keine Kalenderdatei (.ics).');
  const evs = parseIcs(txt, { calId: 'wastefile' });
  const old = store.list('events').filter((e) => e.waste && e.source === 'ics-file');
  old.forEach((e) => store.del('events', e.id));
  store.putMany('events', evs.map((e) => ({ ...e, id: undefined, readOnly: false, external: undefined, waste: true, source: 'ics-file', allDay: e.allDay, remindMin: null })));
  if (!wasteCalendar()) store.put('calendars', { kind: 'waste', name: 'Abfall', url: '', color: '#6B7280', memberIds: [], enabled: false, fileImport: true });
  toast(`🗑️ ${evs.length} Abholtermine importiert`); location.hash = 'abfall'; window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Karte für „Heute“ (nur wenn heute/morgen etwas abgeholt wird) */
export function todayWasteCard() {
  const now = new Date();
  const td = today(); const tm = ymd(addDays(now, 1));
  const t = pickupsOn(td); const m = pickupsOn(tm);
  const show = [...(now.getHours() < 12 ? t.map((p) => ['heute', p]) : []), ...m.map((p) => ['morgen', p])];
  if (!show.length) return null;
  return h('section.section', null, h('h3.section-title', null, 'Abfall'),
    h('a.card.waste-today', { href: '#abfall' }, ...show.map(([when, p]) => {
      const duty = dutyFor(p.wasteKey);
      return h('div.wt-row', { style: { '--c': p.wasteColor } }, h('span.bin-emoji', null, p.wasteEmoji), h('span.wt-main', null, h('b', null, p.wasteName), h('small', null, when === 'morgen' ? 'morgen – heute Abend rausstellen' : 'heute')), duty ? h('small.bin-duty', null, `${duty.emoji || '👤'} ${duty.name}`) : null);
    })));
}

/** Erinnerungen am Vorabend (für die Android-Benachrichtigungen) */
export function wasteReminders(daysAhead = 30) {
  const r = reminderCfg(); if (!r.enabled) return [];
  const now = new Date(); const out = [];
  const [hh, mm] = r.time.split(':').map(Number);
  const byDate = {};
  for (const p of pickups(ymd(addDays(now, 1)), ymd(addDays(now, daysAhead)))) (byDate[p.date] ||= []).push(p);
  for (const [d, ps] of Object.entries(byDate)) {
    const at = fmt.parse(d); at.setDate(at.getDate() - 1); at.setHours(hh, mm, 0, 0);
    if (at.getTime() <= now.getTime()) continue;
    const duty = ps.map((p) => dutyFor(p.wasteKey)).find(Boolean);
    out.push({ key: `w:${d}`, at: at.getTime(), title: `Morgen: ${ps.map((p) => p.wasteEmoji + ' ' + p.wasteName).join(', ')}`, body: duty ? `${duty.name} stellt heute Abend raus` : 'Heute Abend rausstellen' });
  }
  return out;
}
