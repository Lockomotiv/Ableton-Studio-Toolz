#!/usr/bin/env node
// FamilyHub-Server: REST-API + Weboberfläche. Keine externen Abhängigkeiten (Node ≥ 20).
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Db, COLLECTIONS } from './lib/db.js';
import { buildIcs } from './lib/ics.js';
import { Immich } from './lib/immich.js';
import { Notifier } from './lib/notify.js';
import { parse as parseText, describe as describeEntry, ymd as ymdOf, addDays as addDaysOf, relativeDay } from '../web/js/nlp.js';
import { detectCommand } from '../web/js/commands.js';
import { guessCategory } from '../web/js/budgetcats.js';
import { occurrences } from '../web/js/recur.js';
import { parseIcs } from '../web/js/icsparse.js';
import { wasteType } from '../web/js/wastetypes.js';
import { DEFAULT_PLACE, forecastUrl, buildModel } from '../web/js/weathercore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '4.6.1';
let imgErrAt = 0; // Bild-Fehler höchstens einmal pro Minute ins Log
const cfg = {
  port: +(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(here, 'data'),
  webDir: process.env.WEB_DIR || path.join(here, '..', 'web'),
  password: process.env.FAMILYHUB_PASSWORD || '',
  tlsCert: process.env.TLS_CERT || '',
  tlsKey: process.env.TLS_KEY || '',
  immichUrl: process.env.IMMICH_URL || '',
  immichKey: process.env.IMMICH_API_KEY || '',
  immichAlbum: process.env.IMMICH_ALBUM_ID || '',
  immichInsecure: process.env.IMMICH_INSECURE === '1',
};

/** Kleiner HTTP-Client ohne Abhängigkeiten (Redirects, Größenlimit, optional eigene Zertifikate). */
export function fetchRaw(url, { method = 'GET', headers = {}, body, insecure = false, limit = 5 * 1024 * 1024, redirects = 3, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('Ungültige Adresse')); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('Nur http/https'));
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method, headers: { 'User-Agent': 'FamilyHub/3', ...headers }, rejectUnauthorized: !insecure, timeout }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetchRaw(new URL(res.headers.location, u).toString(), { method, headers, body, insecure, limit, redirects: redirects - 1, timeout }));
      }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > limit) { req.destroy(new Error('Antwort zu groß')); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export function createApp(options = {}) {
  const c = { ...cfg, ...options };
  const db = new Db(c.dataDir);
  const auth = db.data.auth;

  if (c.password) setPassword(c.password, false);
  if (!auth.icsKey) { auth.icsKey = token(18); db.save(); }
  if (!auth.photoKey) { auth.photoKey = token(18); db.save(); }
  if (!auth.fileKey) { auth.fileKey = token(18); db.save(); }
  const filesDir = path.join(c.dataDir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const FILE_TYPES = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif|gif)|text\/plain|application\/vnd\.openxmlformats-officedocument\.[a-z.]+|application\/msword)$/;
  // Immich: Umgebungsvariablen haben Vorrang, sonst gilt die in der App gespeicherte Verbindung
  const immichCfg = () => (c.immichUrl && c.immichKey
    ? { url: c.immichUrl, key: c.immichKey, insecure: c.immichInsecure, fromEnv: true }
    : db.data.secrets.immich || null);
  const immich = new Immich(immichCfg, fetchRaw);

  // Abfallkalender auch auf dem Pi laden (für Sprachassistenten über /api/v2/quick)
  const wasteCache = { url: null, at: 0, events: [] };
  async function refreshWaste() {
    const cal = Object.values(db.data.calendars).find((x) => x.kind === 'waste' && !x.deleted && x.url && x.enabled !== false);
    if (!cal) { wasteCache.events = []; return; }
    if (wasteCache.url === cal.url && Date.now() - wasteCache.at < 3600e3) return;
    try {
      const r = await fetchRaw(cal.url.replace(/^webcal:\/\//i, 'https://'), { headers: { Accept: 'text/calendar' } });
      if (r.status === 200) { wasteCache.events = parseIcs(r.body.toString('utf8'), { calId: 'waste' }); wasteCache.url = cal.url; wasteCache.at = Date.now(); }
    } catch { /* später erneut */ }
  }
  const wastePickups = (a, b) => [
    ...wasteCache.events.flatMap((e) => occurrences(e, a, b)),
    ...Object.values(db.data.events).filter((e) => e.waste && !e.deleted).flatMap((e) => occurrences(e, a, b)),
  ].map((e) => { const t = wasteType(e.title); return { date: e.date, wasteKey: t[0], wasteName: t[1] }; }).sort((x, y) => x.date.localeCompare(y.date));
  if (!options.noTimers) { setTimeout(refreshWaste, 2000).unref?.(); setInterval(refreshWaste, 3600e3).unref?.(); }
  db.listeners.add(() => { setTimeout(refreshWaste, 500); });

  // Wetter (für Sprachassistenten und den morgendlichen Anziehtipp)
  const wx = { model: null };
  async function refreshWeatherServer() {
    const p = db.data.settings.weatherPlace || DEFAULT_PLACE;
    try { const r = await fetchRaw(forecastUrl(p), { headers: { Accept: 'application/json' } }); if (r.status === 200) wx.model = buildModel(p, JSON.parse(r.body.toString('utf8'))); } catch { /* später erneut */ }
  }
  if (!options.noTimers) { setTimeout(refreshWeatherServer, 3000).unref?.(); setInterval(refreshWeatherServer, 20 * 60e3).unref?.(); }

  // Push-Benachrichtigungen (iPhone-Web-App & Browser)
  const notifier = new Notifier(db, fetchRaw, { wastePickups: (a, b) => wastePickups(a, b), weather: () => wx.model, log: (m) => console.log(m) });
  if (!options.noTimers) setInterval(() => notifier.tick().catch((e) => console.error('Push:', e.message)), 60e3).unref?.();

  function setPassword(pw, bump = true) {
    const salt = auth.salt && verifyPassword(pw) ? auth.salt : crypto.randomBytes(16).toString('hex');
    auth.salt = salt;
    auth.passwordHash = crypto.pbkdf2Sync(pw, salt, 210000, 32, 'sha256').toString('hex');
    if (bump) db.save(); else db.save();
  }
  function verifyPassword(pw) {
    if (!auth.passwordHash || !auth.salt) return false;
    const h = crypto.pbkdf2Sync(String(pw), auth.salt, 210000, 32, 'sha256');
    return crypto.timingSafeEqual(h, Buffer.from(auth.passwordHash, 'hex'));
  }
  function token(n = 32) { return crypto.randomBytes(n).toString('base64url'); }
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

  function checkToken(req) {
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!t) return null;
    const entry = auth.tokens[sha(t)];
    if (!entry) return null;
    if (Date.now() - (entry.lastSeen || 0) > 3600e3) { entry.lastSeen = Date.now(); db.save(); }
    return entry;
  }

  // einfache Bremse gegen Passwort-Raten
  const attempts = new Map();
  function limited(ip) {
    const now = Date.now();
    const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60e3);
    attempts.set(ip, a);
    return a.length >= 10;
  }

  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

  function send(res, status, body, headers = {}) {
    const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
    res.writeHead(status, {
      'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(isJson ? JSON.stringify(body) : body);
  }

  async function readJson(req, limit = 512 * 1024) {
    let size = 0; const chunks = [];
    for await (const ch of req) { size += ch.length; if (size > limit) throw Object.assign(new Error('Anfrage zu groß'), { status: 413 }); chunks.push(ch); }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Ungültiges JSON'), { status: 400 }); }
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.normalize(path.join(c.webDir, rel));
    if (!file.startsWith(path.normalize(c.webDir))) return send(res, 403, 'Verboten');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Nicht gefunden');
      const ext = path.extname(file);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(buf);
    });
  }

  function newId() { return crypto.randomBytes(9).toString('base64url'); }

  /** Sprachfragen & Erledigt-Meldungen serverseitig (für Sprachassistenten) */
  function commandFor(text, meId) {
    const list = (c) => Object.values(db.data[c]).filter((x) => !x.deleted);
    const members = list('members');
    const now = new Date(); const d = (n) => ymdOf(addDaysOf(now, n));
    const today = d(0);
    const pointsOf = (mid) => list('points').filter((p) => p.memberId === mid).reduce((a, p) => a + (p.delta || 0), 0);
    const safe = (x) => String(x).replace(/[^A-Za-z0-9_-]/g, '');
    const choreKey = (cid, mid, date) => `c_${safe(cid)}_${safe(mid)}_${date.replace(/-/g, '')}`.slice(0, 64); // wie household.js
    const choresFor = (date, mid) => {
      const [y, m, dd] = date.split('-').map(Number); const wd = new Date(y, m - 1, dd).getDay();
      return list('chores').filter((c) => (!c.days?.length || c.days.includes(wd)) && (c.memberIds || []).includes(mid))
        .map((c) => { const p = db.data.points[choreKey(c.id, mid, date)]; return { chore: c, memberId: mid, done: !!p && !p.deleted }; });
    };
    const ctx = {
      members, meId, today, tomorrow: d(1), dayAfter: d(2), weekEnd: d(6), yearEnd: d(365),
      dayLabel: (x) => relativeDay(x, now),
      events: (a, b) => list('events').flatMap((e) => occurrences(e, a, b)).sort((x, y) => (x.date + (x.time || '')).localeCompare(y.date + (y.time || ''))),
      openTasks: list('tasks').filter((t) => !t.done), shopping: list('shopping').filter((s) => !s.done),
      meals: (x) => list('meals').filter((m) => m.date === x), choresFor, balance: pointsOf, guessCategory, pickups: wastePickups, weather: () => wx.model, hour: new Date().getHours(),
      lessons: (mid, date) => { const tt = db.data.timetable['tt_' + safe(mid)]; if (!tt || tt.deleted) return []; const [y, mo, dd] = date.split('-').map(Number); const wd = new Date(y, mo - 1, dd).getDay(); const per = tt.periods || []; return (tt.days?.[wd] || []).map((sub, i) => ({ subject: sub, ...(per[i] || {}) })).filter((x) => x.subject && x.subject !== 'Pause'); },
    };
    const c = detectCommand(text, ctx);
    if (!c || c.type === 'answer') return c;
    const ts = Date.now(); const a = c.action; const ops = [];
    if (a.kind === 'chore') {
      const ch = db.data.chores[a.choreId];
      ops.push({ op: 'put', col: 'points', item: { id: choreKey(ch.id, a.memberId, today), memberId: a.memberId, delta: ch.points || 1, reason: ch.title, date: today, kind: 'chore', ref: ch.id, updatedAt: ts, createdAt: ts } });
    } else if (a.kind === 'task') {
      const t = db.data.tasks[a.taskId];
      const keys = [];
      if (t.points > 0) for (const mid of (t.memberIds || []).filter((id) => db.data.members[id] && !db.data.members[id].deleted)) {
        const id = `t_${String(t.id).replace(/[^A-Za-z0-9_-]/g, '')}_${mid}_${today.replace(/-/g, '')}`.slice(0, 64); keys.push(id);
        ops.push({ op: 'put', col: 'points', item: { id, memberId: mid, delta: t.points, reason: t.title, date: today, kind: 'task', ref: t.id, updatedAt: ts, createdAt: ts } });
      }
      ops.push({ op: 'put', col: 'tasks', item: { ...t, done: true, doneAt: ts, updatedAt: ts, pointKeys: keys } });
    } else if (a.kind === 'budget') {
      ops.push({ op: 'put', col: 'budget', item: { id: newId(), kind: 'entry', type: a.type, amount: a.amount, category: a.category, note: a.note, date: today, memberId: meId || null, createdAt: ts, updatedAt: ts } });
    } else if (a.kind === 'message') {
      if (!meId) return { type: 'answer', title: 'Pinnwand', text: 'Bitte memberId mitschicken, damit klar ist, wer schreibt.', speak: 'Ich weiß nicht, wer schreibt.' };
      ops.push({ op: 'put', col: 'messages', item: { id: newId(), text: a.text, authorId: meId, reactions: {}, pinned: false, createdAt: ts, updatedAt: ts } });
    } else if (a.kind === 'shopping') {
      for (const id of a.ids) ops.push({ op: 'put', col: 'shopping', item: { ...db.data.shopping[id], done: true, doneAt: ts, updatedAt: ts } });
    }
    db.apply(ops);
    return { ...c, done: true };
  }

  function quickAdd(text, meId) {
    const members = Object.values(db.data.members).filter((m) => !m.deleted);
    const p = parseText(text, { members, meId });
    const now = Date.now();
    const ops = [];
    if (p.kind === 'meal') {
      ops.push({ op: 'put', col: 'meals', item: { id: newId(), date: p.date, slot: p.slot || 'dinner', title: p.title, createdAt: now, updatedAt: now } });
    } else if (p.kind === 'shopping') {
      for (const it of p.items) ops.push({ op: 'put', col: 'shopping', item: { id: newId(), name: it.name, category: it.category, done: false, createdAt: now, updatedAt: now } });
    } else {
      const base = { id: newId(), title: p.title, date: p.date, time: p.time, memberIds: p.memberIds, repeat: p.repeat, remindMin: p.remindMin, createdAt: now, updatedAt: now, source: 'voice' };
      if (p.kind === 'event') ops.push({ op: 'put', col: 'events', item: { ...base, endTime: p.endTime, allDay: p.allDay } });
      else ops.push({ op: 'put', col: 'tasks', item: { ...base, priority: p.priority, done: false } });
    }
    db.apply(ops);
    const summary = describeEntry(p, { members });
    return { parsed: p, summary, speak: `Erledigt. ${summary}.`, created: ops.map((o) => ({ col: o.col, id: o.item.id })) };
  }

  async function api(req, res, url) {
    const p = url.pathname;
    const ip = req.socket.remoteAddress || '';

    if (p === '/healthz' || p === '/api/v2/health') {
      return send(res, 200, { status: 'ok', module: 'familyhub', schema: 5, version: VERSION, setup: !auth.passwordHash, immich: immich.configured(), db: db.kind });
    }
    if (p === '/api/v2/setup' && req.method === 'POST') {
      if (auth.passwordHash) return send(res, 409, { error: 'Bereits eingerichtet.' });
      const b = await readJson(req);
      if (!b.password || String(b.password).length < 6) return send(res, 400, { error: 'Passwort mit mindestens 6 Zeichen wählen.' });
      setPassword(String(b.password));
      if (b.familyName) db.data.settings.familyName = String(b.familyName).slice(0, 80);
      const t = token();
      auth.tokens[sha(t)] = { name: String(b.device || 'Gerät').slice(0, 60), created: Date.now(), lastSeen: Date.now() };
      db.bump();
      return send(res, 200, { token: t });
    }
    if (p === '/api/v2/login' && req.method === 'POST') {
      if (limited(ip)) return send(res, 429, { error: 'Zu viele Versuche. Bitte 15 Minuten warten.' });
      const b = await readJson(req);
      if (!auth.passwordHash) return send(res, 409, { error: 'Server ist noch nicht eingerichtet.', setup: true });
      if (!verifyPassword(b.password || '')) {
        attempts.get(ip)?.push(Date.now()) ?? attempts.set(ip, [Date.now()]);
        return send(res, 401, { error: 'Passwort stimmt nicht.' });
      }
      const t = token();
      auth.tokens[sha(t)] = { name: String(b.device || 'Gerät').slice(0, 60), created: Date.now(), lastSeen: Date.now() };
      db.save();
      return send(res, 200, { token: t, familyName: db.data.settings.familyName });
    }
    if (p.startsWith('/api/v2/photos/') && req.method === 'GET') {
      const key = url.searchParams.get('key') || '';
      if (key.length !== auth.photoKey.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(auth.photoKey))) return send(res, 403, 'Ungültiger Schlüssel');
      const id = decodeURIComponent(p.slice('/api/v2/photos/'.length));
      if (!/^[0-9a-f-]{36}$/i.test(id)) return send(res, 400, 'Ungültige ID');
      if (!immich.configured()) return send(res, 404, 'Immich nicht eingerichtet');
      let img;
      try { img = await immich.image(id, url.searchParams.get('size')); } catch (e) {
        if (!imgErrAt || Date.now() - imgErrAt > 60e3) { imgErrAt = Date.now(); console.error(`[Fotos] ${e.message}`); }
        throw e;
      }
      res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'private, max-age=604800, immutable' });
      return res.end(img.body);
    }
    if (p.startsWith('/api/v2/files/') && req.method === 'GET') {
      const key = url.searchParams.get('key') || '';
      if (key.length !== auth.fileKey.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(auth.fileKey))) return send(res, 403, 'Ungültiger Schlüssel');
      const id = p.slice('/api/v2/files/'.length);
      if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return send(res, 400, 'Ungültige ID');
      let meta;
      try { meta = JSON.parse(fs.readFileSync(path.join(filesDir, id + '.json'), 'utf8')); } catch { return send(res, 404, 'Nicht gefunden'); }
      res.writeHead(200, { 'Content-Type': meta.type, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(path.join(filesDir, id)).pipe(res);
    }
    if (p === '/api/v2/calendar.ics') {
      const key = url.searchParams.get('key') || '';
      if (!key || key.length !== auth.icsKey.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(auth.icsKey))) return send(res, 403, 'Ungültiger Schlüssel');
      return send(res, 200, buildIcs(db.publicState(), db.data.settings.familyName), { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'max-age=300' });
    }

    const session = checkToken(req);
    if (!session) return send(res, 401, { error: 'Bitte anmelden.' });

    if (p === '/api/v2/session') {
      return send(res, 200, { user: { device: session.name }, families: [{ name: db.data.settings.familyName }], childProfileId: null, version: VERSION });
    }
    if (p === '/api/v2/state' && req.method === 'GET') {
      const since = +(url.searchParams.get('since') || -1);
      if (since === db.data.rev) return send(res, 200, { unchanged: true, rev: db.data.rev });
      return send(res, 200, db.publicState());
    }
    if (p === '/api/v2/wait' && req.method === 'GET') {
      // Long-Polling: antwortet sofort bei Änderung oder nach 25 s
      const since = +(url.searchParams.get('since') || -1);
      if (since !== db.data.rev) return send(res, 200, { rev: db.data.rev });
      const done = (rev) => { clearTimeout(timer); db.listeners.delete(done); if (!res.writableEnded) send(res, 200, { rev }); };
      const timer = setTimeout(() => done(db.data.rev), 25000);
      db.listeners.add(done);
      req.on('close', () => { clearTimeout(timer); db.listeners.delete(done); });
      return;
    }
    if (p === '/api/v2/batch' && req.method === 'POST') {
      const b = await readJson(req);
      if (!Array.isArray(b.ops) || b.ops.length > 500) return send(res, 400, { error: 'ops fehlt' });
      const existed = new Set(b.ops.filter((o) => o?.op === 'put' && db.data[o.col]?.[o.item?.id]).map((o) => o.col + ':' + o.item.id));
      const result = db.apply(b.ops);
      notifier.afterBatch(b.ops, existed);
      return send(res, 200, result);
    }
    if (p === '/api/v2/settings' && req.method === 'POST') {
      const b = await readJson(req);
      if (typeof b.familyName === 'string') db.data.settings.familyName = b.familyName.slice(0, 80);
      if (typeof b.immichUrl === 'string') db.data.settings.immichUrl = b.immichUrl.slice(0, 200);
      if (b.weatherPlace && Number.isFinite(+b.weatherPlace.lat) && Number.isFinite(+b.weatherPlace.lon)) { db.data.settings.weatherPlace = { name: String(b.weatherPlace.name || 'Ort').slice(0, 80), lat: +b.weatherPlace.lat, lon: +b.weatherPlace.lon }; refreshWeatherServer(); }
      if (/^\d{2}:\d{2}$/.test(b.dressPushTime || '')) db.data.settings.dressPushTime = b.dressPushTime;
      db.bump();
      return send(res, 200, { ok: true, settings: db.data.settings });
    }
    if (p === '/api/v2/parse' && req.method === 'POST') {
      const b = await readJson(req);
      return send(res, 200, parseText(String(b.text || ''), { members: Object.values(db.data.members).filter((m) => !m.deleted) }));
    }
    if (p === '/api/v2/quick' && req.method === 'POST') {
      // Für Sprachassistenten (Home Assistant, Siri-Kurzbefehle, Google-Routinen, Tasker …)
      const b = await readJson(req);
      const text = String(b.text || '').trim();
      if (!text) return send(res, 400, { error: 'text fehlt' });
      const cmd = b.noCommands ? null : commandFor(text, b.memberId);
      if (cmd) return send(res, 200, { command: cmd.type, title: cmd.title, summary: cmd.type === 'answer' ? cmd.text : cmd.speak, speak: cmd.speak, created: [] });
      return send(res, 200, quickAdd(text, b.memberId));
    }
    if (p === '/api/v2/files' && req.method === 'POST') {
      // Dokumente (Impfpass-Foto, Vertrag als PDF …) – als Base64 im JSON, max. 15 MB
      const b = await readJson(req, 21 * 1024 * 1024);
      const type = String(b.type || '').toLowerCase();
      if (!FILE_TYPES.test(type)) return send(res, 415, { error: 'Dateityp nicht erlaubt (PDF, Bilder, Word, Text).' });
      const buf = Buffer.from(String(b.data || ''), 'base64');
      if (!buf.length || buf.length > 15 * 1024 * 1024) return send(res, 413, { error: 'Datei leer oder größer als 15 MB.' });
      const id = newId() + newId();
      fs.writeFileSync(path.join(filesDir, id), buf);
      fs.writeFileSync(path.join(filesDir, id + '.json'), JSON.stringify({ name: String(b.name || 'Dokument').slice(0, 120), type, size: buf.length, created: Date.now() }));
      return send(res, 200, { fileId: id, size: buf.length, key: auth.fileKey });
    }
    if (p === '/api/v2/files-key' && req.method === 'GET') return send(res, 200, { key: auth.fileKey });
    const del = p.match(/^\/api\/v2\/files\/([A-Za-z0-9_-]{8,40})\/delete$/);
    if (del && req.method === 'POST') {
      for (const f of [del[1], del[1] + '.json']) { try { fs.unlinkSync(path.join(filesDir, f)); } catch { /* schon weg */ } }
      return send(res, 200, { ok: true });
    }
    if (p === '/api/v2/push/key' && req.method === 'GET') return send(res, 200, { publicKey: notifier.vapid.publicKey });
    if (p === '/api/v2/push/subscribe' && req.method === 'POST') {
      const b = await readJson(req);
      const id = notifier.subscribe(b.subscription, { memberId: b.memberId || null, device: b.device || session.name });
      if (b.test) await notifier.send(id, { title: 'FamilyHub ✔', body: 'Benachrichtigungen sind auf diesem Gerät aktiv.', tag: 'test', url: '#heute' });
      return send(res, 200, { ok: true, id });
    }
    if (p === '/api/v2/push/unsubscribe' && req.method === 'POST') { const b = await readJson(req); notifier.unsubscribe(b.endpoint); return send(res, 200, { ok: true }); }
    if (p === '/api/v2/tokens' && req.method === 'POST') {
      // eigener Zugangsschlüssel, z. B. für einen Siri-Kurzbefehl
      const b = await readJson(req);
      const t = token();
      auth.tokens[sha(t)] = { name: String(b.name || 'Kurzbefehl').slice(0, 60), created: Date.now(), lastSeen: Date.now() };
      db.save();
      return send(res, 200, { token: t });
    }
    if (p === '/api/v2/settings/waste' && req.method === 'POST') {
      const b = await readJson(req);
      if (/^\d{2}:\d{2}$/.test(b.time || '')) db.data.settings.wasteReminderTime = b.time;
      db.bump(); return send(res, 200, { ok: true });
    }
    if (p === '/api/v2/photos' && req.method === 'GET') {
      if (!immich.configured()) return send(res, 404, { error: 'Immich ist noch nicht verbunden (Mehr → Fotos).' });
      const source = url.searchParams.get('source') || 'random';
      const albumIds = (url.searchParams.get('albums') || '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x));
      const limit = Math.min(500, +(url.searchParams.get('limit') || 80));
      return send(res, 200, { items: await immich.photos({ source, albumIds, limit }), key: auth.photoKey });
    }
    if (p === '/api/v2/photo-albums' && req.method === 'GET') {
      return send(res, 200, { albums: await immich.albums() });
    }
    if (p === '/api/v2/immich' && req.method === 'GET') {
      const cfg = immichCfg();
      return send(res, 200, { configured: immich.configured(), url: cfg?.url || c.immichUrl || null, insecure: !!cfg?.insecure, fromEnv: !!cfg?.fromEnv, user: db.data.secrets.immichUser || null });
    }
    if (p === '/api/v2/immich' && req.method === 'POST') {
      const b = await readJson(req);
      if (b.disconnect) { delete db.data.secrets.immich; db.save(); immich.cache.clear(); return send(res, 200, { configured: false }); }
      const cfg = { url: String(b.url || '').trim().replace(/\/+$/, ''), key: String(b.key || db.data.secrets.immich?.key || '').trim(), insecure: !!b.insecure };
      if (!/^https?:\/\//.test(cfg.url)) return send(res, 400, { error: 'Bitte die Immich-Adresse mit http:// oder https:// angeben.' });
      if (!cfg.key) return send(res, 400, { error: 'Bitte einen API-Schlüssel aus Immich eintragen.' });
      const r = await immich.test(cfg);
      db.data.secrets.immich = cfg; db.data.secrets.immichUser = r.user; db.save(); immich.cache.clear();
      return send(res, 200, { configured: true, ...r });
    }
    if (p === '/api/v2/server-info' && req.method === 'GET') {
      return send(res, 200, { version: VERSION, node: process.version, db: db.stats(), immich: immich.configured() });
    }
    if (p === '/api/v2/fetch' && req.method === 'POST') {
      // Rezeptseiten für den Import in der Browser-Version (in der App lädt das Handy selbst)
      const b = await readJson(req);
      const r = await fetchRaw(String(b.url || ''), { headers: { Accept: 'text/html', 'Accept-Language': 'de-DE,de;q=0.9' }, limit: 4 * 1024 * 1024 }).catch((e) => ({ error: e.message }));
      if (r.error) return send(res, 502, { error: r.error });
      if (r.status !== 200) return send(res, 502, { error: 'Seite antwortet mit HTTP ' + r.status });
      return send(res, 200, { text: r.body.toString('utf8') });
    }
    if (p === '/api/v2/ics-proxy' && req.method === 'POST') {
      // Externe Kalender für die Browser-Version (dort verhindert CORS den direkten Abruf)
      const b = await readJson(req);
      const target = String(b.url || '').replace(/^webcal:\/\//i, 'https://');
      const r = await fetchRaw(target, { headers: { Accept: 'text/calendar' } }).catch((e) => ({ error: e.message }));
      if (r.error) return send(res, 502, { error: r.error });
      if (r.status !== 200) return send(res, 502, { error: 'Kalender antwortet mit HTTP ' + r.status });
      return send(res, 200, { text: r.body.toString('utf8') });
    }
    if (p === '/api/v2/calendar-link' && req.method === 'GET') {
      return send(res, 200, { path: `/api/v2/calendar.ics?key=${auth.icsKey}` });
    }
    if (p === '/api/v2/password' && req.method === 'POST') {
      const b = await readJson(req);
      if (!verifyPassword(b.old || '')) return send(res, 401, { error: 'Altes Passwort stimmt nicht.' });
      if (!b.password || String(b.password).length < 6) return send(res, 400, { error: 'Mindestens 6 Zeichen.' });
      setPassword(String(b.password));
      auth.tokens = {}; // alle Geräte abmelden
      db.save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/v2/devices' && req.method === 'GET') {
      return send(res, 200, Object.entries(auth.tokens).map(([k, v]) => ({ id: k.slice(0, 12), ...v })));
    }
    if (p === '/api/v2/logout' && req.method === 'POST') {
      const t = (req.headers.authorization || '').slice(7);
      delete auth.tokens[sha(t)]; db.save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/v2/export' && req.method === 'GET') {
      return send(res, 200, db.publicState(), { 'Content-Disposition': 'attachment; filename="familyhub-export.json"' });
    }
    if (p === '/api/v2/import' && req.method === 'POST') {
      const b = await readJson(req, 10 * 1024 * 1024);
      const ops = [];
      for (const col of COLLECTIONS) for (const item of b[col] || []) ops.push({ op: 'put', col, item: { ...item, updatedAt: Date.now() } });
      return send(res, 200, db.apply(ops));
    }
    return send(res, 404, { error: 'Unbekannter Endpunkt' });
  }

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    // Die App spricht aus dem WebView (eigene Herkunft) mit dem Server → CORS freigeben.
    // Authentifizierung läuft ausschließlich per Bearer-Token, nicht per Cookie.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      if (url.pathname === '/healthz' || url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Methode nicht erlaubt');
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Interner Fehler' });
      if (!e.status) console.error(e);
    }
  };

  return { handler, db, quickAdd, notifier };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { handler, db } = createApp();
  const server = cfg.tlsCert && cfg.tlsKey
    ? https.createServer({ cert: fs.readFileSync(cfg.tlsCert), key: fs.readFileSync(cfg.tlsKey) }, handler)
    : http.createServer(handler);
  server.listen(cfg.port, cfg.host, () => {
    console.log(`FamilyHub ${VERSION} läuft auf ${cfg.tlsCert ? 'https' : 'http'}://${cfg.host}:${cfg.port}  (Daten: ${cfg.dataDir})`);
    if (!db.data.auth.passwordHash) console.log('Noch kein Passwort gesetzt → in der App „Server verbinden“ wählen oder FAMILYHUB_PASSWORD setzen.');
  });
  const stop = () => { db.close(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
