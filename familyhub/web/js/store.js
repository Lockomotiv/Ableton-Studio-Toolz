// Datenhaltung: lokal zuerst (funktioniert offline), optional Abgleich mit dem FamilyHub-Server auf dem Pi.
import { http, notify, isApp } from './native.js';

/** Im Browser vom Pi geladen (iPhone-Web-App, PC): dann ist der Pi immer die eigene Adresse. */
export const webOrigin = !isApp && typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && !/appassets/.test(location.host) ? location.origin + '/' : null;

export const COLLECTIONS = ['members', 'events', 'tasks', 'shopping', 'notes', 'chores', 'routines', 'rewards', 'points', 'routinelog', 'meals', 'recipes', 'calendars', 'messages', 'contacts', 'lists', 'listitems', 'budget', 'timetable', 'documents', 'catalog'];
const KEY_DATA = 'fh3.data';
const KEY_CFG = 'fh3.config';
const KEY_OUT = 'fh3.outbox';

export const DEFAULT_CONFIG = {
  server: {
    mode: 'off', // off | auto | home | mobile
    home: 'http://192.168.178.51:8446/',
    mobile: 'http://autodartspi.tail318476.ts.net:8446/',
    token: null, active: null, rev: -1, lastSync: 0, familyName: null,
  },
  services: {
    immichHome: 'https://192.168.178.51:8444/',
    immichMobile: 'https://autodartspi.tail318476.ts.net:8444/',
    casaHome: 'http://192.168.178.51:81/',
    casaMobile: 'http://autodartspi.tail318476.ts.net:81/',
    controlHome: 'https://192.168.178.51:8445/',
    controlMobile: '',
    controlToken: null,
  },
  meId: null,
  theme: 'system',
  voiceAutoSave: false,
  voiceSpeak: true,
  remindDefault: 30,
  child: { pinHash: null, activeMemberId: null },
  familyName: 'Unsere Familie',
  onboarded: false,
  filterMember: null,
};

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function persist(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* voll */ } }

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? deepMerge(base[k], v) : v;
  return out;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2) + Date.now().toString(36));

class Store {
  constructor() {
    this.config = deepMerge(DEFAULT_CONFIG, load(KEY_CFG, {}));
    const raw = load(KEY_DATA, {});
    this.data = {};
    for (const c of COLLECTIONS) this.data[c] = raw[c] || {};
    this.outbox = load(KEY_OUT, []);
    this.listeners = new Set();
    this.sync = { state: 'idle', error: null, online: null };
    this._polling = false;
    this.rejected = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(reason) { for (const l of this.listeners) l(reason); }

  saveConfig(patch) {
    if (patch) this.config = deepMerge(this.config, patch);
    persist(KEY_CFG, this.config);
    this.emit('config');
  }
  saveData() { persist(KEY_DATA, this.data); }

  list(col) { return Object.values(this.data[col]).filter((x) => !x.deleted); }
  get(col, id) { const x = this.data[col][id]; return x && !x.deleted ? x : null; }

  put(col, item) {
    const now = Date.now();
    const it = { ...item, id: item.id || uid(), updatedAt: now };
    if (!it.createdAt) it.createdAt = now;
    this.data[col][it.id] = it;
    this.saveData();
    this.queue({ op: 'put', col, item: it });
    this.emit('data');
    return it;
  }
  putMany(col, items) {
    const now = Date.now();
    const out = items.map((item) => {
      const it = { ...item, id: item.id || uid(), updatedAt: now, createdAt: item.createdAt || now };
      this.data[col][it.id] = it;
      this.queue({ op: 'put', col, item: it }, true);
      return it;
    });
    this.saveData(); persist(KEY_OUT, this.outbox); this.kick(); this.emit('data');
    return out;
  }
  del(col, id) {
    const now = Date.now();
    this.data[col][id] = { id, deleted: true, updatedAt: now };
    this.saveData();
    this.queue({ op: 'del', col, id, updatedAt: now });
    this.emit('data');
  }

  queue(op, silent) {
    if (!this.serverEnabled()) return;
    // nur die letzte Änderung pro Eintrag behalten
    const key = op.col + ':' + (op.item?.id || op.id);
    this.outbox = this.outbox.filter((o) => o.col + ':' + (o.item?.id || o.id) !== key);
    this.outbox.push(op);
    if (!silent) { persist(KEY_OUT, this.outbox); this.kick(); }
  }

  kick() { clearTimeout(this._kick); this._kick = setTimeout(() => this.syncNow(), 400); }

  // ---------------- Server ----------------
  serverEnabled() { return this.config.server.mode !== 'off' && !!this.config.server.token; }

  candidates() {
    const s = this.config.server;
    if (webOrigin) return [webOrigin];
    const list = s.mode === 'home' ? [s.home] : s.mode === 'mobile' ? [s.mobile] : [s.active, s.home, s.mobile];
    return [...new Set(list.filter(Boolean).map(normalizeBase))];
  }

  async probe(base, timeout = 3500) {
    try {
      const r = await http(base + 'healthz', { timeout });
      if (r.status !== 200 || typeof r.data !== 'object') return { ok: false, msg: `HTTP ${r.status}` };
      if (r.data.module === 'familyhub' && r.data.schema >= 4) return { ok: true, setup: !!r.data.setup, version: r.data.version, data: r.data };
      if (r.data.module === 'accounts') return { ok: false, legacy: true, msg: 'Alter FamilyHub-Server (Version 2) – bitte Server aktualisieren' };
      return { ok: false, msg: 'Antwort stammt nicht von FamilyHub' };
    } catch (e) {
      return { ok: false, msg: e.kind === 'ssl' ? 'Zertifikat wird nicht vertraut' : e.kind === 'dns' ? 'Name nicht gefunden' : e.kind === 'timeout' ? 'Keine Antwort (Netzwerk/Tailscale?)' : 'Nicht erreichbar' };
    }
  }

  async resolveBase() {
    const s = this.config.server;
    if (s.active && this._activeChecked && Date.now() - this._activeChecked < 60000) return s.active;
    for (const base of this.candidates()) {
      const p = await this.probe(base, 2500);
      if (p.ok) { this._activeChecked = Date.now(); if (s.active !== base) this.saveConfig({ server: { active: base } }); return base; }
    }
    throw new Error('Server nicht erreichbar');
  }

  async request(path, opts = {}) {
    const base = await this.resolveBase();
    const r = await http(base + path, { ...opts, headers: { Authorization: 'Bearer ' + this.config.server.token, ...(opts.headers || {}) } });
    if (r.status === 401) {
      this.saveConfig({ server: { token: null } });
      this.setSync('error', 'Abgemeldet – bitte neu anmelden');
      throw new Error('Abgemeldet');
    }
    if (r.status >= 400) throw new Error(r.data?.error || 'HTTP ' + r.status);
    return r.data;
  }

  setSync(state, error = null) { this.sync = { ...this.sync, state, error }; this.emit('sync'); }

  async syncNow() {
    if (!this.serverEnabled() || this._syncing) return;
    this._syncing = true;
    this.setSync('syncing');
    try {
      if (this.outbox.length) {
        const ops = this.outbox.slice(0, 200);
        const res = await this.request('api/v2/batch', { method: 'POST', body: { ops } });
        // Vom Server abgelehnte Einträge lokal behalten (nie stillschweigend Daten verlieren)
        (res.results || []).forEach((r, i) => { if (r && r.ok === false) this.rejected.add(ops[i].col + ':' + (ops[i].item?.id || ops[i].id)); });
        this.outbox = this.outbox.slice(ops.length);
        persist(KEY_OUT, this.outbox);
        if (res.rev === this.config.server.rev + 1) this.config.server.rev = res.rev; // nur eigene Änderung
      }
      const st = await this.request('api/v2/state?since=' + this.config.server.rev);
      if (!st.unchanged) this.mergeServer(st);
      this.saveConfig({ server: { lastSync: Date.now(), rev: st.rev } });
      this.setSync('ok');
      if (this.outbox.length) this.kick();
      this.startPolling();
    } catch (e) {
      this.setSync('error', e.message);
    } finally { this._syncing = false; }
  }

  mergeServer(st) {
    const pendingKeys = new Set([...this.outbox.map((o) => o.col + ':' + (o.item?.id || o.id)), ...this.rejected]);
    this.notifyAssigned(st);
    for (const c of COLLECTIONS) {
      const next = {};
      for (const it of st[c] || []) next[it.id] = it;
      // lokale, noch nicht übertragene Änderungen behalten
      for (const [id, it] of Object.entries(this.data[c])) if (pendingKeys.has(c + ':' + id)) next[id] = it;
      this.data[c] = next;
    }
    if (st.settings?.familyName) this.config.familyName = st.settings.familyName;
    if (st.settings?.weatherPlace && JSON.stringify(st.settings.weatherPlace) !== JSON.stringify(this.config.weatherPlace)) this.config.weatherPlace = st.settings.weatherPlace;
    this.saveData();
    this.emit('data');
  }

  /** Hinweis, wenn jemand anderes mir einen neuen Termin / eine Aufgabe / ein Amt zuteilt. */
  notifyAssigned(st) {
    const me = this.config.meId;
    if (!me || this.config.server.rev < 0 || this.config.child?.activeMemberId) return;
    const labels = { events: 'Neuer Termin', tasks: 'Neue Aufgabe', chores: 'Neues Amt' };
    const fresh = [];
    for (const col of Object.keys(labels)) {
      for (const it of st[col] || []) {
        if (it.deleted || this.data[col][it.id] || !it.memberIds?.includes(me)) continue;
        if (it.createdBy === me || it.external) continue;
        fresh.push(`${labels[col]}: ${it.title}`);
      }
    }
    for (const m of st.messages || []) {
      if (m.deleted || this.data.messages[m.id] || m.authorId === me) continue;
      const who = (st.members || []).find((x) => x.id === m.authorId)?.name || 'Familie';
      fresh.push(`💬 ${who}: ${m.text.slice(0, 80)}`);
    }
    if (!fresh.length) return;
    notify(fresh.length === 1 ? fresh[0] : `${fresh.length} neue Einträge für dich`, fresh.length === 1 ? 'Von deiner Familie eingetragen' : fresh.slice(0, 4).join(' · '));
  }

  async startPolling() {
    if (this._polling || !this.serverEnabled()) return;
    this._polling = true;
    while (this.serverEnabled() && !document.hidden) {
      try {
        const r = await this.request('api/v2/wait?since=' + this.config.server.rev, { timeout: 30000 });
        if (r.rev !== this.config.server.rev) await this.syncNow();
      } catch { await new Promise((ok) => setTimeout(ok, 15000)); }
    }
    this._polling = false;
  }

  async connect({ base, password, setup, familyName, device }) {
    base = normalizeBase(base);
    const p = await this.probe(base, 5000);
    if (!p.ok) throw new Error(p.msg);
    const path = setup ? 'api/v2/setup' : 'api/v2/login';
    const r = await http(base + path, { method: 'POST', body: { password, familyName, device } });
    if (r.status !== 200) throw new Error(r.data?.error || 'Anmeldung fehlgeschlagen');
    const hadLocal = COLLECTIONS.some((c) => this.list(c).length);
    this.saveConfig({ server: { token: r.data.token, active: base, rev: -1, mode: this.config.server.mode === 'off' ? 'auto' : this.config.server.mode } });
    if (hadLocal) {
      // bisher lokal erfasste Einträge mit hochladen
      for (const c of COLLECTIONS) for (const it of Object.values(this.data[c])) this.queue({ op: it.deleted ? 'del' : 'put', col: c, item: it, id: it.id, updatedAt: it.updatedAt }, true);
      persist(KEY_OUT, this.outbox);
    }
    await this.syncNow();
    return r.data;
  }

  disconnect() {
    this.saveConfig({ server: { token: null, mode: 'off', rev: -1 } });
    this.outbox = []; persist(KEY_OUT, this.outbox);
    this.setSync('idle');
  }

  exportJson() {
    const out = { app: 'FamilyHub', version: 3, exported: new Date().toISOString() };
    for (const c of COLLECTIONS) out[c] = this.list(c);
    return JSON.stringify(out, null, 2);
  }
  importJson(txt) {
    const d = JSON.parse(txt);
    let n = 0;
    for (const c of COLLECTIONS) if (Array.isArray(d[c])) { this.putMany(c, d[c].filter((x) => x && x.id && !x.deleted)); n += d[c].length; }
    return n;
  }
}

export function normalizeBase(u) {
  u = String(u || '').trim();
  if (!u) return u;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '') + '/';
}

export const store = new Store();
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) store.syncNow(); });
  window.addEventListener('online', () => store.syncNow());
}
