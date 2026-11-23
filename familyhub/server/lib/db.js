// Datenbank des FamilyHub-Servers.
// Standard: SQLite (in Node ≥ 22 eingebaut, keine Zusatzpakete) – robust gegen Stromausfall dank WAL-Journal,
// tägliche Sicherung per "VACUUM INTO". Fallback: JSON-Datei (ältere Node-Versionen).
// Im Speicher liegt eine Kopie aller Daten; geschrieben werden nur geänderte Einträge.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export const COLLECTIONS = ['members', 'events', 'tasks', 'shopping', 'notes', 'chores', 'routines', 'rewards', 'points', 'routinelog', 'meals', 'recipes', 'calendars',
  'messages', 'contacts', 'lists', 'listitems', 'budget', 'timetable', 'documents'];

const EMPTY = () => ({
  schema: 5,
  rev: 0,
  ...Object.fromEntries(COLLECTIONS.map((c) => [c, {}])),
  settings: { familyName: 'Unsere Familie' },
  auth: { passwordHash: null, salt: null, tokens: {}, icsKey: null },
  secrets: {}, // z. B. Immich-API-Schlüssel – wird nie an Geräte ausgeliefert
});
const META_KEYS = ['schema', 'rev', 'settings', 'auth', 'secrets'];

function loadSqlite() {
  if (process.env.FAMILYHUB_DB === 'json') return null;
  try {
    const require = createRequire(import.meta.url);
    // Hinweis "ExperimentalWarning" von node:sqlite unterdrücken
    const orig = process.emitWarning;
    process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : orig.call(process, w, ...a));
    const mod = require('node:sqlite');
    process.emitWarning = orig;
    return mod.DatabaseSync;
  } catch { return null; }
}

export class Db {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    this.jsonFile = path.join(dir, 'familyhub.json');
    this.sqliteFile = path.join(dir, 'familyhub.sqlite');
    this.data = EMPTY();
    this.dirty = new Map(); // "col\0id" → true
    this.timer = null;
    this.listeners = new Set();
    const DatabaseSync = loadSqlite();
    this.kind = DatabaseSync ? 'sqlite' : 'json';
    if (DatabaseSync) this.openSqlite(DatabaseSync); else this.openJson();
  }

  // ---------------- SQLite ----------------
  openSqlite(DatabaseSync) {
    const fresh = !fs.existsSync(this.sqliteFile);
    this.sql = new DatabaseSync(this.sqliteFile);
    this.sql.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, updated INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (col, id));
      CREATE INDEX IF NOT EXISTS docs_updated ON docs(updated);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.stUpsert = this.sql.prepare('INSERT INTO docs (col, id, json, updated, deleted) VALUES (?, ?, ?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET json = excluded.json, updated = excluded.updated, deleted = excluded.deleted');
    this.stDelete = this.sql.prepare('DELETE FROM docs WHERE col = ? AND id = ?');
    this.stMeta = this.sql.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    if (fresh && fs.existsSync(this.jsonFile)) {
      // Umzug aus der JSON-Datei (FamilyHub 3.0–3.3)
      this.readJson();
      for (const c of COLLECTIONS) for (const id of Object.keys(this.data[c])) this.dirty.set(c + '\0' + id, true);
      this.flush();
      fs.renameSync(this.jsonFile, this.jsonFile + '.migrated');
      console.log('Daten aus familyhub.json in die SQLite-Datenbank übernommen.');
      return;
    }
    for (const row of this.sql.prepare('SELECT key, value FROM meta').all()) {
      try { this.data[row.key] = JSON.parse(row.value); } catch { /* defekt → Standard */ }
    }
    this.data.auth = { ...EMPTY().auth, ...(this.data.auth || {}) };
    this.data.secrets = this.data.secrets || {};
    for (const row of this.sql.prepare('SELECT col, id, json FROM docs').iterate()) {
      if (!this.data[row.col]) continue; // Sammlung aus späterer Version
      try { this.data[row.col][row.id] = JSON.parse(row.json); } catch { /* überspringen */ }
    }
    this.data.schema = 5;
  }

  // ---------------- JSON (Fallback) ----------------
  readJson() {
    const loaded = JSON.parse(fs.readFileSync(this.jsonFile, 'utf8'));
    this.data = { ...EMPTY(), ...loaded, auth: { ...EMPTY().auth, ...(loaded.auth || {}) }, secrets: loaded.secrets || {} };
    for (const c of COLLECTIONS) this.data[c] = this.data[c] || {};
    this.data.schema = 5;
  }
  openJson() { if (fs.existsSync(this.jsonFile)) this.readJson(); }

  mark(col, id) { this.dirty.set(col + '\0' + id, true); }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    clearTimeout(this.timer);
    if (this.kind === 'sqlite') {
      this.sql.exec('BEGIN');
      try {
        for (const key of this.dirty.keys()) {
          const [col, id] = key.split('\0');
          const doc = this.data[col]?.[id];
          if (!doc) this.stDelete.run(col, id);
          else this.stUpsert.run(col, id, JSON.stringify(doc), Number(doc.updatedAt) || 0, doc.deleted ? 1 : 0);
        }
        for (const k of META_KEYS) this.stMeta.run(k, JSON.stringify(this.data[k]));
        this.sql.exec('COMMIT');
        this.dirty.clear();
      } catch (e) { this.sql.exec('ROLLBACK'); throw e; }
    } else {
      const tmp = this.jsonFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.jsonFile);
      this.dirty.clear();
    }
    this.backup();
  }

  backup() {
    const day = new Date().toISOString().slice(0, 10);
    const ext = this.kind === 'sqlite' ? 'sqlite' : 'json';
    const target = path.join(this.dir, 'backups', `familyhub-${day}.${ext}`);
    if (fs.existsSync(target)) return;
    try {
      if (this.kind === 'sqlite') this.sql.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      else fs.copyFileSync(this.jsonFile, target);
    } catch (e) { console.error('Sicherung fehlgeschlagen:', e.message); return; }
    const files = fs.readdirSync(path.join(this.dir, 'backups')).filter((f) => f.startsWith('familyhub-')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.unlinkSync(path.join(this.dir, 'backups', f));
  }

  close() { this.flush(); if (this.sql) this.sql.close(); }

  bump() {
    this.data.rev += 1;
    this.save();
    for (const l of this.listeners) l(this.data.rev);
    return this.data.rev;
  }

  publicState() {
    const s = { schema: this.data.schema, rev: this.data.rev, settings: this.data.settings };
    for (const c of COLLECTIONS) s[c] = Object.values(this.data[c]);
    return s;
  }

  stats() {
    const counts = Object.fromEntries(COLLECTIONS.map((c) => [c, Object.values(this.data[c]).filter((x) => !x.deleted).length]));
    let size = 0;
    try { size = fs.statSync(this.kind === 'sqlite' ? this.sqliteFile : this.jsonFile).size; } catch { /* neu */ }
    return { kind: this.kind, size, counts, rev: this.data.rev };
  }

  /**
   * Wendet Änderungen an. Konfliktregel: "der neueste Stand gewinnt" (updatedAt).
   * Gelöschte Einträge bleiben als Grabstein ({id, deleted:true}) erhalten, damit andere Geräte es mitbekommen.
   */
  apply(ops) {
    let changed = 0;
    const results = [];
    for (const op of ops) {
      if (!op || !COLLECTIONS.includes(op.col)) { results.push({ ok: false, error: 'unbekannte Sammlung' }); continue; }
      const col = this.data[op.col];
      if (op.op === 'put') {
        const item = sanitize(op.item);
        if (!item) { results.push({ ok: false, error: 'ungültiger Eintrag' }); continue; }
        const prev = col[item.id];
        if (prev && (prev.updatedAt || 0) > (item.updatedAt || 0)) { results.push({ ok: true, skipped: true }); continue; }
        col[item.id] = item; this.mark(op.col, item.id);
        changed++; results.push({ ok: true });
      } else if (op.op === 'del') {
        const id = String(op.id || '');
        if (!id) { results.push({ ok: false }); continue; }
        col[id] = { id, deleted: true, updatedAt: op.updatedAt || Date.now() }; this.mark(op.col, id);
        changed++; results.push({ ok: true });
      } else results.push({ ok: false, error: 'unbekannte Operation' });
    }
    if (changed) this.bump();
    this.prune();
    return { rev: this.data.rev, results };
  }

  /** Grabsteine nach 60 Tagen entfernen. */
  prune() {
    const cutoff = Date.now() - 60 * 864e5;
    for (const c of COLLECTIONS) {
      for (const [id, it] of Object.entries(this.data[c])) {
        if (it.deleted && (it.updatedAt || 0) < cutoff) { delete this.data[c][id]; this.mark(c, id); }
      }
    }
  }
}

const MAX_STRING = 4000;
function sanitize(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const id = String(item.id || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const json = JSON.stringify(item);
  if (json.length > 40000) return null;
  const clean = JSON.parse(json, (k, v) => (typeof v === 'string' && v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v));
  clean.updatedAt = Number(clean.updatedAt) || Date.now();
  return clean;
}
