import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildModel, dressAdvice, speakWeather, wmo, DEFAULT_PLACE, forecastUrl } from '../../web/js/weathercore.js';

// künstlicher Tag: f(h) liefert {temp, feels, pop, precip, code, gust, uv, snow}
function day(date, f) {
  const hourly = { time: [], temperature_2m: [], apparent_temperature: [], precipitation_probability: [], precipitation: [], weather_code: [], wind_speed_10m: [], wind_gusts_10m: [], uv_index: [], is_day: [], snowfall: [] };
  for (let hr = 0; hr < 24; hr++) {
    const v = { pop: 0, precip: 0, code: 1, gust: 10, uv: 0, snow: 0, ...f(hr) };
    hourly.time.push(`${date}T${String(hr).padStart(2, '0')}:00`); hourly.temperature_2m.push(v.temp); hourly.apparent_temperature.push(v.feels ?? v.temp);
    hourly.precipitation_probability.push(v.pop); hourly.precipitation.push(v.precip); hourly.weather_code.push(v.code); hourly.wind_speed_10m.push(10); hourly.wind_gusts_10m.push(v.gust); hourly.uv_index.push(v.uv); hourly.is_day.push(hr > 6 && hr < 20 ? 1 : 0); hourly.snowfall.push(v.snow);
  }
  const temps = hourly.temperature_2m;
  return buildModel(DEFAULT_PLACE, { current: { temperature_2m: temps[12], weather_code: hourly.weather_code[12], is_day: 1 }, hourly,
    daily: { time: [date], weather_code: [hourly.weather_code[14]], temperature_2m_max: [Math.max(...temps)], temperature_2m_min: [Math.min(...temps)], precipitation_probability_max: [Math.max(...hourly.precipitation_probability)], precipitation_sum: [hourly.precipitation.reduce((a, b) => a + b, 0)] } });
}
const labels = (a) => a.items.map((i) => i.label).join(' | ');

test('Hochsommer, Kind', () => {
  const m = day('2026-07-15', (h) => ({ temp: 18 + Math.max(0, 14 - Math.abs(15 - h)), uv: h > 10 && h < 17 ? 7 : 1, code: 0 }));
  const a = dressAdvice(m, '2026-07-15', { role: 'child', name: 'Lena' });
  assert.match(labels(a), /Kurze Hose/); assert.match(labels(a), /Sonnencreme LSF 50/); assert.match(labels(a), /Sonnenhut/);
  assert.doesNotMatch(labels(a), /Jacke|Mütze/);
});
test('Regnerischer Herbsttag, Erwachsene', () => {
  const m = day('2026-10-20', (h) => ({ temp: 7 + (h > 8 && h < 17 ? 5 : 0), feels: 5 + (h > 8 && h < 17 ? 4 : 0), pop: h >= 15 ? 80 : 20, precip: h >= 15 ? 1.2 : 0, code: h >= 15 ? 63 : 3 }));
  const a = dressAdvice(m, '2026-10-20', { role: 'parent' });
  assert.match(labels(a), /Warme Jacke/); assert.match(labels(a), /Wasserfeste Schuhe/); assert.match(labels(a), /Regenschirm/);
  assert.ok(a.tips.some((t) => t.includes('Regen ab etwa 15 Uhr')), a.tips.join(' / '));
});
test('Frost mit Schnee, Kind', () => {
  const m = day('2026-01-10', (h) => ({ temp: -4, feels: -9, code: 73, snow: 0.4, precip: 0.3, pop: 70 }));
  const a = dressAdvice(m, '2026-01-10', { role: 'child' });
  for (const x of [/Schneeanzug|Winterjacke/, /Schneehose/, /Winterstiefel/, /Mütze/, /Schal/, /Handschuhe/]) assert.match(labels(a), x);
  assert.ok(a.tips.some((t) => /Glätte/.test(t)) && a.tips.some((t) => /Wechselsachen/.test(t)));
});
test('Echte Open-Meteo-Antwort für Lübben', () => {
  const fc = JSON.parse(fs.readFileSync(new URL('./fixture-openmeteo-luebben.json', import.meta.url)));
  const m = buildModel(DEFAULT_PLACE, fc);
  assert.equal(m.daily.length, 7); assert.equal(m.hourly.length, 168);
  assert.equal(typeof m.current.temp, 'number');
  const a = dressAdvice(m, m.daily[0].date, { role: 'child' });
  assert.ok(a.items.length >= 4, labels(a));
  assert.match(speakWeather(m, m.daily[0].date), /^Heute in Lübben: .+ Grad/);
  assert.equal(wmo(95)[1], 'thunder');
  assert.match(forecastUrl(DEFAULT_PLACE), /latitude=51\.93814/);
});
