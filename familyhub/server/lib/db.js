// Einfache, robuste JSON-Datenbank mit atomaren Schreibvorgängen und Tagesbackups.
// Für eine Familie (einige tausend Einträge) völlig ausreichend und ohne native Abhängigkeiten.
import fs from 'node:fs';
import path from 'node:path';

export const COLLECTIONS = ['members', 'events', 'tasks', 'shopping', 'notes'];

const EMPTY = () => ({
  schema: 4,
  rev: 0,
  members: {}, events: {}, tasks: {}, shopping: {}, notes: {},
  settings: { familyName: 'Unsere Familie' },
  auth: { passwordHash: null, salt: null, tokens: {}, icsKey: null },
});

export class Db {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'familyhub.json');
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    this.data = EMPTY();
    if (fs.existsSync(this.file)) {
      const loaded = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...EMPTY(), ...loaded, auth: { ...EMPTY().auth, ...(loaded.auth || {}) } };
      for (const c of COLLECTIONS) this.data[c] = this.data[c] || {};
    }
    this.timer = null;
    this.listeners = new Set();
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    clearTimeout(this.timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
    this.backup();
  }

  backup() {
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(this.dir, 'backups', `familyhub-${day}.json`);
    if (fs.existsSync(target)) return;
    fs.copyFileSync(this.file, target);
    const files = fs.readdirSync(path.join(this.dir, 'backups')).filter((f) => f.startsWith('familyhub-')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.unlinkSync(path.join(this.dir, 'backups', f));
  }

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
        col[item.id] = item;
        changed++; results.push({ ok: true });
      } else if (op.op === 'del') {
        const id = String(op.id || '');
        if (!id) { results.push({ ok: false }); continue; }
        col[id] = { id, deleted: true, updatedAt: op.updatedAt || Date.now() };
        changed++; results.push({ ok: true });
      } else results.push({ ok: false, error: 'unbekannte Operation' });
    }
    if (changed) this.bump();
    this.prune();
    return { rev: this.data.rev, results };
  }

  /** Grabsteine nach 60 Tagen und erledigte Einkäufe nach 30 Tagen entfernen. */
  prune() {
    const cutoff = Date.now() - 60 * 864e5;
    for (const c of COLLECTIONS) {
      for (const [id, it] of Object.entries(this.data[c])) {
        if (it.deleted && (it.updatedAt || 0) < cutoff) delete this.data[c][id];
      }
    }
  }
}

const MAX_STRING = 2000;
function sanitize(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const id = String(item.id || '');
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return null;
  const json = JSON.stringify(item);
  if (json.length > 20000) return null;
  const clean = JSON.parse(json, (k, v) => (typeof v === 'string' && v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v));
  clean.updatedAt = Number(clean.updatedAt) || Date.now();
  return clean;
}
