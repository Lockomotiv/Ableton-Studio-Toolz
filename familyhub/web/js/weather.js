// Wetter: Karte auf „Heute“, eigene Rubrik mit Animationen, Details, Warnungen, Pollen und Anzieh-Assistent.
import { h, icon, toast, sheet, fmt } from './ui.js';
import { store } from './store.js';
import { members, member, today, childMode } from './domain.js';
import { ymd, addDays } from './nlp.js';
import { http, isApp, speak } from './native.js';
import { DEFAULT_PLACE, forecastUrl, airUrl, alertsUrl, geocodeUrl, buildModel, wmo, wxEmoji, dressAdvice, speakWeather, speakDress, rainStart, aqiLabel, windDir, beaufort } from './weathercore.js';

const KEY = 'fh3.weather';
let model = load();
let loading = null;
function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(model)); } catch { /* voll */ } }

export function place() { return store.config.weatherPlace || DEFAULT_PLACE; }
export function weather() { return model && model.place?.lat === place().lat ? model : null; }

async function getJson(url) {
  if (isApp) { const r = await http(url, { timeout: 15000 }); if (r.status >= 400) throw new Error('HTTP ' + r.status); return typeof r.data === 'string' ? JSON.parse(r.data) : r.data; }
  const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
}

/** Wetter laden (Zwischenspeicher 20 Minuten) */
export async function refreshWeather(force = false) {
  const p = place();
  if (!force && model && model.place?.lat === p.lat && Date.now() - model.fetched < 20 * 60e3) return model;
  if (loading) return loading;
  loading = (async () => {
    try {
      const [fc, air, al] = await Promise.all([getJson(forecastUrl(p)), getJson(airUrl(p)).catch(() => null), getJson(alertsUrl(p)).catch(() => null)]);
      model = buildModel(p, fc, air, al); save();
      store.emit('data');
    } catch (e) { if (!model) throw e; } finally { loading = null; }
    return model;
  })();
  return loading;
}
if (typeof window !== 'undefined') {
  setTimeout(() => refreshWeather().catch(() => {}), 1500);
  setInterval(() => { if (!document.hidden) refreshWeather().catch(() => {}); }, 15 * 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshWeather().catch(() => {}); });
}

// ================= Animierte Wetterszene =================
/** Szene aus Sonne/Mond, Wolken, Regen, Schnee, Blitz, Nebel – nur CSS-Animationen */
export function weatherArt(code, isDay = 1, size = 'md') {
  const type = wmo(code)[1];
  const el = h(`div.wx-art.wx-${size}.wxt-${type}${isDay ? '.day' : '.night'}`, { 'aria-hidden': 'true' });
  const sun = h('div.wx-sun', null, h('div.wx-rays'));
  const moon = h('div.wx-moon');
  const cloud = (cls) => h('div.wx-cloud.' + cls);
  if (type === 'clear') el.append(isDay ? sun : moon, isDay ? null : h('div.wx-stars', null, ...Array.from({ length: 6 }, (_, i) => h('i', { style: { left: (10 + i * 15) + '%', top: (8 + (i * 37) % 40) + '%', animationDelay: (i * 0.4) + 's' } }))));
  else if (type === 'partly') el.append(isDay ? sun : moon, cloud('c1'));
  else if (type === 'fog') el.append(cloud('c1.grey'), h('div.wx-fog', null, h('i'), h('i'), h('i')));
  else el.append(cloud('c2.grey'), cloud('c1' + (['rain', 'showers', 'thunder', 'sleet'].includes(type) ? '.dark' : '.grey')));
  if (['drizzle', 'rain', 'showers', 'sleet', 'thunder'].includes(type)) {
    const n = type === 'drizzle' ? 6 : type === 'rain' && code >= 65 ? 14 : 10;
    el.append(h('div.wx-rain' + (type === 'drizzle' ? '.light' : ''), null, ...Array.from({ length: n }, (_, i) => h('i', { style: { left: (12 + (i * 71) % 76) + '%', animationDelay: ((i * 0.37) % 1.1).toFixed(2) + 's' } }))));
  }
  if (['snow', 'sleet'].includes(type)) el.append(h('div.wx-snow', null, ...Array.from({ length: 10 }, (_, i) => h('i', { style: { left: (10 + (i * 53) % 80) + '%', animationDelay: ((i * 0.53) % 2.6).toFixed(2) + 's', animationDuration: (2.4 + (i % 3) * 0.6) + 's' } }, '❄'))));
  if (type === 'thunder') el.append(h('div.wx-bolt'));
  return el;
}
const sceneClass = (code, isDay) => `wx-bg-${wmo(code)[1]}${isDay ? '' : '-night'}`;

// ================= Karte auf „Heute“ =================
export function todayWeatherCard() {
  const m = weather();
  if (!m) { refreshWeather().catch(() => {}); return h('a.card.wx-card.loading', { href: '#wetter' }, h('span.muted', null, '🌤 Wetter wird geladen …')); }
  const c = m.current; const d = m.daily[0];
  const now = new Date();
  const after18 = now.getHours() >= 18;
  const date = after18 ? m.daily[1]?.date : d.date;
  const me = childMode() || member(store.config.meId) || { role: 'parent' };
  const adv = dressAdvice(m, date, me);
  const rs = rainStart(m, d.date, now.getHours());
  const warn = m.warnings[0];
  return h('a.card.wx-card.' + sceneClass(c.code, c.isDay), { href: '#wetter' },
    weatherArt(c.code, c.isDay, 'sm'),
    h('div.wx-card-main', null,
      h('div.wx-card-top', null, h('b.wx-temp', null, Math.round(c.temp) + '°'), h('span', null, wmo(c.code)[0])),
      h('small', null, `${m.place.name.replace(/\s*\(.*\)/, '')} · ${Math.round(d.min)}° / ${Math.round(d.max)}° · gefühlt ${Math.round(c.feels)}°`),
      warn ? h('small.wx-warn', null, '⚠️ ' + warn.event) : rs != null ? h('small', null, `🌧 Regen ab etwa ${rs} Uhr`) : null,
      adv ? h('small.wx-dress', null, `${after18 ? 'Morgen' : 'Heute'} anziehen: ${adv.items.slice(0, 4).map((i) => i.emoji + ' ' + i.label.split(/[(/+]/)[0].trim()).join(', ')}`) : null),
    icon('right', 18));
}

// ================= Rubrik „Wetter“ =================
const ws = { day: 0, who: null };
export function viewWeather() {
  const page = h('div.page.weather');
  const rerender = () => page.replaceWith(viewWeather());
  const m = weather();
  page.append(h('div.page-head', null, h('a.icon-btn', { href: '#heute', 'aria-label': 'Zurück' }, icon('left')), h('h1', null, 'Wetter'),
    h('button.icon-btn', { 'aria-label': 'Aktualisieren', onclick: async () => { try { await refreshWeather(true); rerender(); toast('Aktualisiert'); } catch (e) { toast('Wetter nicht erreichbar: ' + e.message); } } }, icon('sync'))));
  if (!m) {
    page.append(h('p.soft', null, 'Wetter wird geladen …'));
    refreshWeather().then(rerender).catch((e) => page.append(h('p.status.bad', null, '○ Wetterdienst nicht erreichbar: ' + e.message)));
    return page;
  }
  const c = m.current; const d0 = m.daily[0];
  // Hero
  page.append(h('div.wx-hero.' + sceneClass(c.code, c.isDay), null,
    weatherArt(c.code, c.isDay, 'lg'),
    h('div.wx-hero-text', null,
      h('button.wx-place', { onclick: choosePlace }, '📍 ', m.place.name, ' ▾'),
      h('div.wx-big', null, Math.round(c.temp) + '°'),
      h('div.wx-cond', null, wmo(c.code)[0]),
      h('div.wx-sub', null, `Gefühlt ${Math.round(c.feels)}° · H ${Math.round(d0.max)}° T ${Math.round(d0.min)}°`),
      h('div.wx-sub.small', null, `Stand ${new Date(m.fetched).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · Open-Meteo${m.warnings.length ? ' · DWD' : ''}`))));
  // Warnungen
  for (const w of m.warnings) page.append(h('details.card.wx-alert.sev-' + (w.severity || 'minor'), null, h('summary', null, '⚠️ ', h('b', null, w.event), h('small', null, ` · bis ${w.expires ? new Date(w.expires).toLocaleString('de-DE', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '–'}`)), h('p', null, w.headline), w.text ? h('p.muted', null, w.text) : null, w.instruction ? h('p.muted', null, w.instruction) : null));

  // Stündlich (nächste 24 h)
  const nowH = new Date(); nowH.setMinutes(0, 0, 0);
  const next = m.hourly.filter((x) => new Date(x.time) >= nowH).slice(0, 24);
  page.append(h('section.section', null, h('h3.section-title', null, 'Nächste 24 Stunden'),
    h('div.wx-hours', null, ...next.map((x, i) => h('div.wx-hour', null,
      h('small', null, i === 0 ? 'Jetzt' : x.time.slice(11, 13) + ' Uhr'),
      h('span.wx-hicon', null, wxEmoji(x.code, x.isDay)),
      h('b', null, Math.round(x.temp) + '°'),
      h('small.wx-pop' + (x.pop >= 50 ? '.hi' : ''), null, x.pop ? `💧${x.pop}%` : ' '))))));

  // Anzieh-Assistent
  page.append(dressSection(m, rerender));

  // 7 Tage
  const gMin = Math.min(...m.daily.map((d) => d.min)); const gMax = Math.max(...m.daily.map((d) => d.max));
  page.append(h('section.section', null, h('h3.section-title', null, '7 Tage'),
    h('div.wx-days', null, ...m.daily.map((d, i) => h('button.wx-day' + (ws.day === i ? '.on' : ''), { onclick: () => { ws.day = i; rerender(); document.querySelector('.dress')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
      h('span.wx-dname', null, i === 0 ? 'Heute' : i === 1 ? 'Morgen' : fmt.WD[fmt.parse(d.date).getDay()]),
      h('span.wx-dicon', null, wxEmoji(d.code, 1)),
      h('small.wx-pop' + (d.pop >= 50 ? '.hi' : ''), null, d.pop >= 20 ? `${d.pop}%` : ''),
      h('span.wx-min', null, Math.round(d.min) + '°'),
      h('span.wx-range', null, h('i', { style: { left: ((d.min - gMin) / Math.max(1, gMax - gMin)) * 100 + '%', right: (100 - ((d.max - gMin) / Math.max(1, gMax - gMin)) * 100) + '%' } })),
      h('span.wx-max', null, Math.round(d.max) + '°'))))));

  // Details
  const tile = (ic, label, val, sub) => h('div.wx-tile', null, h('small', null, ic + ' ' + label), h('b', null, val), sub ? h('small', null, sub) : null);
  const sun = (t) => (t ? t.slice(11, 16) : '–');
  page.append(h('section.section', null, h('h3.section-title', null, 'Details'), h('div.wx-tiles', null,
    tile('💨', 'Wind', `${Math.round(c.wind)} km/h`, `${windDir(c.dir)} · Böen ${Math.round(c.gust)} km/h · Bft ${beaufort(c.wind)}`),
    tile('💧', 'Luftfeuchte', `${c.humidity} %`, c.pressure ? `${Math.round(c.pressure)} hPa` : ''),
    tile('☀️', 'UV-Index', `${Math.round(d0.uvMax)}`, d0.uvMax >= 6 ? 'hoch – Sonnenschutz!' : d0.uvMax >= 3 ? 'mittel – Sonnencreme' : 'gering'),
    tile('🌅', 'Sonne', `${sun(d0.sunrise)} – ${sun(d0.sunset)}`, d0.daylight ? `${Math.floor(d0.daylight / 3600)} Std. ${Math.round((d0.daylight % 3600) / 60)} Min. Tageslicht` : ''),
    tile('🌧', 'Niederschlag', `${(d0.precip || 0).toFixed(1).replace('.', ',')} mm`, `Risiko ${d0.pop} %${d0.snow ? ` · ${d0.snow.toFixed(1).replace('.', ',')} cm Schnee` : ''}`),
    m.aqi != null ? tile('🫁', 'Luftqualität', aqiLabel(m.aqi), `EAQI ${Math.round(m.aqi)}`) : null)));
  if (m.pollen?.length) page.append(h('section.section', null, h('h3.section-title', null, '🌾 Pollenflug heute'), h('div.pollen', null, ...m.pollen.map((p) => h('div.pollen-row.lv-' + p.level, null, h('span', null, p.name), h('span.pollen-bar', null, h('i')), h('small', null, p.level))))));
  page.append(h('p.hint', null, 'Wetterdaten: Open-Meteo.com (CC BY 4.0) · Unwetterwarnungen: Deutscher Wetterdienst über Bright Sky.'));
  return page;
}

function dressSection(m, rerender) {
  const fam = childMode() ? [childMode()] : members();
  if (!ws.who || !fam.some((x) => x.id === ws.who)) ws.who = (childMode() || member(store.config.meId) || fam[0])?.id || null;
  const who = member(ws.who) || { role: 'parent', name: '' };
  const d = m.daily[ws.day] || m.daily[0];
  const a = dressAdvice(m, d.date, who);
  const label = ws.day === 0 ? 'heute' : ws.day === 1 ? 'morgen' : fmt.dayLabel(d.date);
  return h('section.section.dress', null,
    h('div.serv-row', null, h('h3.section-title', null, `👕 Was ziehe ich ${label} an?`), h('span.spacer'),
      h('button.btn.small.tonal', { onclick: () => speak(speakWeather(m, d.date, ws.day === 0 ? 'Heute' : ws.day === 1 ? 'Morgen' : fmt.dayLabel(d.date)) + ' ' + speakDress(m, d.date, who, label)) }, '🔊 Vorlesen')),
    fam.length > 1 ? h('div.filter.tight', null, ...fam.map((x) => h('button.fchip' + (x.id === ws.who ? '.on' : ''), { style: { '--c': x.color }, onclick: () => { ws.who = x.id; rerender(); } }, h('span.dot'), x.name))) : null,
    h('div.seg', null, ...[0, 1, 2].map((i) => h('button.seg-btn' + (ws.day === i ? '.on' : ''), { onclick: () => { ws.day = i; rerender(); } }, i === 0 ? 'Heute' : i === 1 ? 'Morgen' : fmt.WD[fmt.parse(m.daily[i]?.date || today()).getDay()]))),
    a ? h('div.card.dress-card', null,
      h('p.dress-head', null, a.headline, who.role === 'child' ? h('small', null, ' · Kinder-Empfehlung (7–16 Uhr)') : h('small', null, ' · 7–19 Uhr')),
      h('div.dress-grid', null, ...a.items.map((i) => h('div.dress-item', null, h('span.di-emoji', null, i.emoji), h('span.di-label', null, i.label), i.why ? h('small', null, i.why) : null))),
      a.tips.length ? h('ul.dress-tips', null, ...a.tips.map((t) => h('li', null, t))) : null)
      : h('p.soft', null, 'Für diesen Tag gibt es noch keine stündliche Vorhersage.'));
}

function choosePlace() {
  let input; const list = h('div.menu');
  const search = async () => {
    const q = input.value.trim(); if (q.length < 2) return;
    list.replaceChildren(h('p.soft', null, 'Suche …'));
    try {
      const r = await getJson(geocodeUrl(q));
      const res = r.results || [];
      list.replaceChildren(...(res.length ? res.map((x) => h('button.menu-row', { onclick: () => setPlace({ name: x.name + (x.admin3 && !x.admin3.startsWith('Kreisfreie') ? '' : ''), lat: x.latitude, lon: x.longitude, region: [x.admin1, x.country].filter(Boolean).join(', ') }) }, h('span.mi.emoji-mi', null, '📍'), h('span.mt', null, h('b', null, x.name), h('small', null, [x.postcodes?.[0], x.admin3 || x.admin2, x.admin1, x.country].filter(Boolean).join(' · '))))) : [h('p.soft', null, 'Kein Ort gefunden.')]));
    } catch (e) { list.replaceChildren(h('p.status.bad', null, e.message)); }
  };
  let api;
  const setPlace = (p) => {
    store.saveConfig({ weatherPlace: p });
    if (store.serverEnabled()) store.request('api/v2/settings', { method: 'POST', body: { weatherPlace: p } }).catch(() => {});
    model = null; api.close(); refreshWeather(true).then(() => { location.hash = 'wetter'; window.dispatchEvent(new HashChangeEvent('hashchange')); }).catch((e) => toast(e.message));
  };
  api = sheet(() => h('div.sheet-body', null, h('h2.sheet-title', null, 'Ort für das Wetter'),
    h('form.addbar', { onsubmit: (e) => { e.preventDefault(); search(); } }, input = h('input', { type: 'search', placeholder: 'Ort oder PLZ, z. B. Lübben', autofocus: true }), h('button.icon-btn.primary', { type: 'submit', 'aria-label': 'Suchen' }, icon('right'))),
    list, h('button.btn.ghost', { onclick: () => setPlace(DEFAULT_PLACE) }, '📍 Lübben (Spreewald)')), { tall: true, label: 'Ort' });
}

/** Kurztext für Widget & Wandansicht */
export function weatherLine() {
  const m = weather(); if (!m) return null;
  const d = m.daily[0]; const c = m.current;
  const rs = rainStart(m, d.date, new Date().getHours());
  return `${wxEmoji(c.code, c.isDay)} ${Math.round(c.temp)}° (${Math.round(d.min)}/${Math.round(d.max)}°)${rs != null ? ` · Regen ab ${rs} Uhr` : ''}`;
}
export { ymd, addDays };
