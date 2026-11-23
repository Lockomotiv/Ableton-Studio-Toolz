// Wetter (Open-Meteo, DWD-Warnungen über Bright Sky) und Anzieh-Assistent.
// Rein, ohne Oberfläche: genutzt von App, Pi-Server und Sprachsteuerung.

export const DEFAULT_PLACE = { name: 'Lübben (Spreewald)', lat: 51.93814, lon: 13.88826 };

// WMO-Wettercodes → [Text, Art]
const WMO = {
  0: ['Klar', 'clear'], 1: ['Überwiegend klar', 'clear'], 2: ['Teilweise bewölkt', 'partly'], 3: ['Bedeckt', 'cloudy'],
  45: ['Nebel', 'fog'], 48: ['Nebel mit Reif', 'fog'],
  51: ['Leichter Nieselregen', 'drizzle'], 53: ['Nieselregen', 'drizzle'], 55: ['Starker Nieselregen', 'drizzle'],
  56: ['Gefrierender Nieselregen', 'sleet'], 57: ['Gefrierender Nieselregen', 'sleet'],
  61: ['Leichter Regen', 'rain'], 63: ['Regen', 'rain'], 65: ['Starker Regen', 'rain'],
  66: ['Gefrierender Regen', 'sleet'], 67: ['Gefrierender Regen', 'sleet'],
  71: ['Leichter Schneefall', 'snow'], 73: ['Schneefall', 'snow'], 75: ['Starker Schneefall', 'snow'], 77: ['Schneegriesel', 'snow'],
  80: ['Regenschauer', 'showers'], 81: ['Regenschauer', 'showers'], 82: ['Heftige Regenschauer', 'showers'],
  85: ['Schneeschauer', 'snow'], 86: ['Starke Schneeschauer', 'snow'],
  95: ['Gewitter', 'thunder'], 96: ['Gewitter mit Hagel', 'thunder'], 99: ['Schweres Gewitter mit Hagel', 'thunder'],
};
export const wmo = (c) => WMO[c] || ['Unbekannt', 'cloudy'];
const EMOJI = { clear: ['☀️', '🌙'], partly: ['⛅', '☁️'], cloudy: ['☁️', '☁️'], fog: ['🌫️', '🌫️'], drizzle: ['🌦️', '🌧️'], rain: ['🌧️', '🌧️'], showers: ['🌦️', '🌧️'], sleet: ['🌨️', '🌨️'], snow: ['❄️', '❄️'], thunder: ['⛈️', '⛈️'] };
export const wxEmoji = (code, isDay = 1) => EMOJI[wmo(code)[1]][isDay ? 0 : 1];
const isWet = (type) => ['drizzle', 'rain', 'showers', 'sleet', 'thunder'].includes(type);

export function forecastUrl({ lat, lon }) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day,uv_index,pressure_msl,cloud_cover'
    + '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,uv_index,is_day,snowfall'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max,snowfall_sum,daylight_duration'
    + '&timezone=Europe%2FBerlin&forecast_days=7';
}
export const airUrl = ({ lat, lon }) => `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,birch_pollen,grass_pollen,alder_pollen,mugwort_pollen,ragweed_pollen&hourly=birch_pollen,grass_pollen,alder_pollen,mugwort_pollen,ragweed_pollen&forecast_days=2&timezone=Europe%2FBerlin`;
export const alertsUrl = ({ lat, lon }) => `https://api.brightsky.dev/alerts?lat=${lat}&lon=${lon}`;
export const geocodeUrl = (q) => `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=de&format=json`;

/** Antworten der Dienste → einheitliches Modell */
export function buildModel(place, fc, air = null, alerts = null) {
  const c = fc.current || {};
  const H = fc.hourly || {}; const D = fc.daily || {};
  const hourly = (H.time || []).map((t, i) => ({ time: t, temp: H.temperature_2m[i], feels: H.apparent_temperature[i], pop: H.precipitation_probability?.[i] ?? 0, precip: H.precipitation?.[i] ?? 0, code: H.weather_code[i], wind: H.wind_speed_10m?.[i] ?? 0, gust: H.wind_gusts_10m?.[i] ?? 0, uv: H.uv_index?.[i] ?? 0, isDay: H.is_day?.[i] ?? 1, snow: H.snowfall?.[i] ?? 0 }));
  const daily = (D.time || []).map((d, i) => ({ date: d, code: D.weather_code[i], max: D.temperature_2m_max[i], min: D.temperature_2m_min[i], feelsMax: D.apparent_temperature_max?.[i], feelsMin: D.apparent_temperature_min?.[i], precip: D.precipitation_sum?.[i] ?? 0, pop: D.precipitation_probability_max?.[i] ?? 0, sunrise: D.sunrise?.[i], sunset: D.sunset?.[i], uvMax: D.uv_index_max?.[i] ?? 0, windMax: D.wind_speed_10m_max?.[i] ?? 0, gustMax: D.wind_gusts_10m_max?.[i] ?? 0, snow: D.snowfall_sum?.[i] ?? 0, daylight: D.daylight_duration?.[i] ?? 0 }));
  let pollen = null; let aqi = null;
  if (air?.current) {
    aqi = air.current.european_aqi ?? null;
    const names = { birch_pollen: 'Birke', grass_pollen: 'Gräser', alder_pollen: 'Erle', mugwort_pollen: 'Beifuß', ragweed_pollen: 'Ambrosia' };
    // Tageshöchstwert (heute) statt nur aktueller Stunde
    const today = (air.hourly?.time || []).map((t, i) => [t, i]).filter(([t]) => t.slice(0, 10) === (daily[0]?.date || ''));
    pollen = Object.entries(names).map(([k, n]) => {
      const vals = today.map(([, i]) => air.hourly[k]?.[i] ?? 0);
      const v = Math.max(air.current[k] ?? 0, ...vals, 0);
      return { key: k, name: n, value: Math.round(v), level: pollenLevel(k, v) };
    }).filter((p) => p.value > 0);
  }
  const warnings = (alerts?.alerts || []).map((a) => ({ event: a.event_de || a.event_en, headline: a.headline_de || a.headline_en, severity: a.severity, onset: a.onset, expires: a.expires, text: a.description_de || a.description_en, instruction: a.instruction_de || '' }));
  return {
    place, fetched: Date.now(),
    current: { temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, precip: c.precipitation, code: c.weather_code, wind: c.wind_speed_10m, gust: c.wind_gusts_10m, dir: c.wind_direction_10m, isDay: c.is_day ?? 1, uv: c.uv_index ?? 0, pressure: c.pressure_msl, clouds: c.cloud_cover, time: c.time },
    hourly, daily, pollen, aqi, warnings,
  };
}
function pollenLevel(k, v) {
  const t = k === 'grass_pollen' ? [5, 30, 80] : [10, 50, 150]; // grob nach DWD-Belastungsstufen
  return v >= t[2] ? 'stark' : v >= t[1] ? 'mittel' : v >= t[0] ? 'gering' : 'keine';
}
export function aqiLabel(v) { if (v == null) return null; return v <= 20 ? 'sehr gut' : v <= 40 ? 'gut' : v <= 60 ? 'mäßig' : v <= 80 ? 'schlecht' : 'sehr schlecht'; }
export function windDir(deg) { if (deg == null) return ''; return ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]; }
export function beaufort(kmh) { const b = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]; let i = 0; while (i < b.length && kmh >= b[i]) i++; return i; }

/** Stunden eines Tages in einem Zeitfenster */
function window(model, date, from, to) { return model.hourly.filter((h) => h.time.slice(0, 10) === date && +h.time.slice(11, 13) >= from && +h.time.slice(11, 13) <= to); }

/** Wann fängt es an zu regnen? (erste Stunde ab jetzt mit ≥ 50 % bzw. ≥ 0,3 mm) */
export function rainStart(model, date, fromHour = 0) {
  const h = model.hourly.find((x) => x.time.slice(0, 10) === date && +x.time.slice(11, 13) >= fromHour && (x.pop >= 50 || x.precip >= 0.3));
  return h ? +h.time.slice(11, 13) : null;
}

/**
 * Anzieh-Empfehlung für eine Person und einen Tag.
 * @param who { name, role: 'child' | 'parent' | 'other' }
 * @returns { headline, items: [{emoji, label, why}], tips: [] , stats }
 */
export function dressAdvice(model, date, who = { role: 'parent' }) {
  const kid = who.role === 'child';
  const hours = window(model, date, 7, kid ? 16 : 19);
  const d = model.daily.find((x) => x.date === date);
  if (!hours.length || !d) return null;
  const feels = hours.map((h) => h.feels);
  const fMin = Math.min(...feels); const fMax = Math.max(...feels);
  const tMin = Math.min(...hours.map((h) => h.temp));
  const pop = Math.max(...hours.map((h) => h.pop));
  const rainMm = hours.reduce((s, h) => s + (h.precip || 0), 0);
  const snowCm = hours.reduce((s, h) => s + (h.snow || 0), 0);
  const gust = Math.max(...hours.map((h) => h.gust || 0));
  const uv = Math.max(...hours.map((h) => h.uv || 0));
  const types = hours.map((h) => wmo(h.code)[1]);
  // nass nur bei nennenswertem Risiko – eine einzelne Niesel-Stunde mit 10 % zählt nicht
  const wet = pop >= 50 || rainMm >= 1 || (types.some(isWet) && pop >= 30);
  const snow = snowCm >= 0.5 || types.includes('snow');
  const thunder = types.includes('thunder');
  const sunny = types.filter((t) => t === 'clear' || t === 'partly').length >= hours.length / 2;
  const items = [];
  const add = (emoji, label, why) => items.push({ emoji, label, why });

  // Jacke (nach der kältesten gefühlten Temperatur im Zeitfenster)
  const cold = kid ? fMin - 2 : fMin; // Kinder kühlen schneller aus
  if (cold <= 0) add('🧥', snow && kid ? 'Schneeanzug oder Winterjacke' : 'Winterjacke', `gefühlt bis ${Math.round(fMin)}°`);
  else if (cold <= 8) add('🧥', 'Warme Jacke', `gefühlt ${Math.round(fMin)}° am Morgen`);
  else if (cold <= 14) add(wet ? '🧥' : '🧥', wet ? 'Wasserdichte Übergangsjacke' : 'Übergangsjacke', `morgens ${Math.round(fMin)}°`);
  else if (cold <= 19) add(wet ? '☔' : '🧥', wet ? 'Leichte Regenjacke' : 'Leichte Jacke oder Weste', `${Math.round(fMin)}–${Math.round(fMax)}°`);
  else if (wet) add('☔', 'Regenjacke', 'Schauer möglich');

  // Oberteil
  if (fMax >= 24) add('👕', 'T-Shirt / Top', `bis ${Math.round(fMax)}°`);
  else if (fMax >= 18) add('👕', fMin < 14 ? 'T-Shirt + dünner Pulli zum Ausziehen' : 'T-Shirt oder Bluse', `${Math.round(fMin)}–${Math.round(fMax)}°`);
  else if (fMax >= 11) add('🧶', 'Langarmshirt + Pullover', `höchstens ${Math.round(fMax)}°`);
  else add('🧶', fMax <= 2 ? 'Thermo-Unterhemd + dicker Pullover' : 'Warmer Pullover oder Fleece', `höchstens ${Math.round(fMax)}°`);

  // Hose
  if (fMax >= 23 && !wet) add('🩳', kid ? 'Kurze Hose oder Kleid' : 'Kurze Hose / Rock', 'warm & trocken');
  else if (cold <= 0) add('👖', kid ? 'Gefütterte Hose oder Strumpfhose drunter' : 'Lange Hose, ggf. Thermo-Leggings', 'Frost');
  else add('👖', 'Lange Hose', '');
  if (kid && (wet || snow)) add('🦺', snow ? 'Schneehose' : 'Matschhose', snow ? 'Schnee' : 'nass draußen');

  // Schuhe
  if (snow || tMin <= 1) add('🥾', 'Gefütterte Winterstiefel', snow ? 'Schnee' : 'Frost & Glätte');
  else if (wet) add(kid ? '🥾' : '👞', kid ? 'Gummistiefel' : 'Wasserfeste Schuhe', rainMm ? `${rainMm.toFixed(1).replace('.', ',')} mm Regen` : `${pop} % Regenrisiko`);
  else if (fMax >= 24) add('🩴', kid ? 'Sandalen (für draußen Turnschuhe)' : 'Sandalen oder leichte Schuhe', 'warm');
  else add('👟', 'Sneaker / Turnschuhe', '');

  // Zubehör
  if (cold <= (kid ? 10 : 7)) add('🧢', 'Mütze', `${Math.round(fMin)}°`);
  if (cold <= 4) add('🧣', 'Schal', '');
  if (cold <= 2) add('🧤', 'Handschuhe', '');
  if (wet && !kid && gust < 50) add('🌂', 'Regenschirm', `${pop} % Regenrisiko`);
  if (uv >= 3) { add('🧴', `Sonnencreme LSF ${kid ? 50 : 30}`, `UV-Index ${Math.round(uv)}`); add(kid ? '👒' : '🕶️', kid ? 'Sonnenhut / Kappe' : 'Sonnenbrille', 'Sonne'); }
  else if (sunny && fMax >= 15 && !kid) add('🕶️', 'Sonnenbrille', 'sonnig');
  if (fMax >= 27) add('💧', 'Trinkflasche', 'heiß');

  const tips = [];
  if (fMax - fMin >= 8) tips.push(`Zwiebellook: morgens ${Math.round(fMin)}°, später ${Math.round(fMax)}° – Schichten zum Ausziehen.`);
  const rs = rainStart(model, date, 7);
  if (rs != null && !hours.slice(0, 2).some((h) => h.pop >= 50)) tips.push(`Regen ab etwa ${rs} Uhr – Regenschutz einpacken.`);
  if (thunder) tips.push('Gewitter möglich – bei Blitz und Donner drinnen bleiben.');
  if (gust >= 60) tips.push(`Sturmböen bis ${Math.round(gust)} km/h – Schirm lieber zu Hause lassen, auf Äste achten.`);
  else if (gust >= 45) tips.push(`Windig, Böen bis ${Math.round(gust)} km/h.`);
  if (tMin <= 1 && (wet || snow || model.hourly.some((h) => h.time.slice(0, 10) === date && h.precip > 0))) tips.push('Glättegefahr auf Wegen und Radwegen.');
  if (kid && (wet || snow)) tips.push('Wechselsachen für Kita/Schule einpacken.');
  if (kid && cold <= 5) tips.push('Unter die Jacke lieber eine Schicht mehr – Kinder frieren schneller.');
  const strongPollen = (model.pollen || []).filter((p) => p.level === 'stark' || p.level === 'mittel').map((p) => p.name);
  if (strongPollen.length && date === model.daily[0]?.date) tips.push(`Pollenflug: ${strongPollen.join(', ')}.`);

  const [text] = wmo(d.code);
  const headline = `${text}, ${Math.round(d.min)}° bis ${Math.round(d.max)}°${wet ? ', Regen möglich' : snow ? ', Schnee' : ''}`;
  return { headline, items, tips, stats: { fMin, fMax, pop, rainMm, uv, gust, wet, snow } };
}

/** Ein Satz zum Vorlesen */
export function speakWeather(model, date, label = 'Heute') {
  const d = model.daily.find((x) => x.date === date); if (!d) return 'Für diesen Tag habe ich keine Vorhersage.';
  const [text] = wmo(d.code);
  const rs = rainStart(model, date, label === 'Heute' ? new Date().getHours() : 6);
  return `${label} in ${model.place.name.replace(/\s*\(.*\)/, '')}: ${text}, ${Math.round(d.min)} bis ${Math.round(d.max)} Grad${d.pop >= 30 ? `, Regenrisiko ${d.pop} Prozent` : ''}${rs != null ? `, Regen ab etwa ${rs} Uhr` : ''}.`;
}
export function speakDress(model, date, who, label = 'heute') {
  const a = dressAdvice(model, date, who); if (!a) return 'Dafür habe ich keine Vorhersage.';
  const list = a.items.map((i) => i.label);
  const joined = list.length > 1 ? list.slice(0, -1).join(', ') + ' und ' + list[list.length - 1] : list[0];
  return `${who?.name ? who.name + ' ' : ''}${label}: ${joined}.${a.tips[0] ? ' ' + a.tips[0] : ''}`.replace(/^(\S+) heute:/, '$1 heute:');
}
