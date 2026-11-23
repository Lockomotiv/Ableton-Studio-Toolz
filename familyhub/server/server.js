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
import { parse as parseText, describe as describeEntry } from '../web/js/nlp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '3.2.0';
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
  const immich = () => ({ url: (c.immichUrl || '').replace(/\/+$/, ''), key: c.immichKey, album: c.immichAlbum, insecure: c.immichInsecure });
  const photoCache = { at: 0, items: [] };
  async function immichPhotos() {
    const im = immich();
    if (!im.url || !im.key) throw Object.assign(new Error('Immich ist auf dem Server nicht eingerichtet (IMMICH_URL / IMMICH_API_KEY).'), { status: 404 });
    if (Date.now() - photoCache.at < 10 * 60e3 && photoCache.items.length) return [...photoCache.items].sort(() => Math.random() - 0.5).slice(0, 60);
    const hdr = { 'x-api-key': im.key, Accept: 'application/json', 'Content-Type': 'application/json' };
    let assets = [];
    if (im.album) {
      const r = await fetchRaw(`${im.url}/api/albums/${encodeURIComponent(im.album)}`, { headers: hdr, insecure: im.insecure });
      if (r.status !== 200) throw Object.assign(new Error('Immich-Album nicht lesbar (HTTP ' + r.status + ')'), { status: 502 });
      assets = JSON.parse(r.body.toString()).assets || [];
    } else {
      const r = await fetchRaw(`${im.url}/api/search/random`, { method: 'POST', headers: hdr, body: JSON.stringify({ size: 120, type: 'IMAGE' }), insecure: im.insecure });
      if (r.status !== 200) throw Object.assign(new Error('Immich antwortet nicht wie erwartet (HTTP ' + r.status + ')'), { status: 502 });
      assets = JSON.parse(r.body.toString());
    }
    photoCache.items = assets.filter((a) => a.type === 'IMAGE' || !a.type).map((a) => ({ id: a.id }));
    photoCache.at = Date.now();
    return [...photoCache.items].sort(() => Math.random() - 0.5).slice(0, 60);
  }

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
    return { parsed: p, summary: describeEntry(p, { members }), created: ops.map((o) => ({ col: o.col, id: o.item.id })) };
  }

  async function api(req, res, url) {
    const p = url.pathname;
    const ip = req.socket.remoteAddress || '';

    if (p === '/healthz' || p === '/api/v2/health') {
      return send(res, 200, { status: 'ok', module: 'familyhub', schema: 4, version: VERSION, setup: !auth.passwordHash, immich: c.immichUrl || null });
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
      const im = immich();
      if (!im.url || !im.key) return send(res, 404, 'Immich nicht eingerichtet');
      const r = await fetchRaw(`${im.url}/api/assets/${id}/thumbnail?size=preview`, { headers: { 'x-api-key': im.key }, insecure: im.insecure, limit: 15 * 1024 * 1024 });
      if (r.status !== 200) return send(res, 502, 'Bild nicht verfügbar');
      res.writeHead(200, { 'Content-Type': r.headers['content-type'] || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
      return res.end(r.body);
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
      return send(res, 200, db.apply(b.ops));
    }
    if (p === '/api/v2/settings' && req.method === 'POST') {
      const b = await readJson(req);
      if (typeof b.familyName === 'string') db.data.settings.familyName = b.familyName.slice(0, 80);
      if (typeof b.immichUrl === 'string') db.data.settings.immichUrl = b.immichUrl.slice(0, 200);
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
      return send(res, 200, quickAdd(text, b.memberId));
    }
    if (p === '/api/v2/photos' && req.method === 'GET') {
      return send(res, 200, { items: await immichPhotos(), key: auth.photoKey });
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

  return { handler, db, quickAdd };
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
  const stop = () => { db.flush(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
