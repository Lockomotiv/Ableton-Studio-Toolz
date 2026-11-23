// Anbindung an Immich (läuft auf demselben Pi). Der API-Schlüssel bleibt auf dem Server;
// die Geräte bekommen nur Bild-IDs und laden Vorschaubilder über /api/v2/photos/<id>.
//
// Benötigte Rechte des API-Schlüssels (Immich → Kontoeinstellungen → API-Schlüssel):
//   asset.read, asset.view, album.read   (oder "Alle")

export class Immich {
  constructor(getConfig, fetchRaw) {
    this.getConfig = getConfig; // () => {url, key, insecure}
    this.fetchRaw = fetchRaw;
    this.cache = new Map();
  }

  cfg() {
    const c = this.getConfig() || {};
    return { url: String(c.url || '').replace(/\/+$/, ''), key: c.key || '', insecure: !!c.insecure };
  }
  configured() { const c = this.cfg(); return !!(c.url && c.key); }

  async call(path, { method = 'GET', body, cfg = this.cfg(), binary = false, limit } = {}) {
    if (!cfg.url) throw Object.assign(new Error('Immich ist noch nicht verbunden.'), { status: 404 });
    const headers = { Accept: binary ? 'image/*' : 'application/json', ...(cfg.key ? { 'x-api-key': cfg.key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
    let r;
    try {
      r = await this.fetchRaw(cfg.url + path, { method, headers, body: body ? JSON.stringify(body) : undefined, insecure: cfg.insecure, limit: limit || (binary ? 20e6 : 8e6), timeout: 20000 });
    } catch (e) {
      const msg = /self.signed|certificate|CERT/i.test(e.message) ? 'Zertifikat von Immich wird nicht vertraut – „Selbstsigniertes Zertifikat erlauben“ aktivieren' : `Immich nicht erreichbar (${e.message})`;
      throw Object.assign(new Error(msg), { status: 502 });
    }
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Immich lehnt den API-Schlüssel ab (fehlende Rechte?)'), { status: 502 });
    if (r.status >= 400) throw Object.assign(new Error(`Immich antwortet mit HTTP ${r.status} auf ${path}`), { status: 502, code: r.status });
    if (binary) return r;
    try { return JSON.parse(r.body.toString('utf8')); } catch { throw Object.assign(new Error('Unerwartete Antwort von Immich'), { status: 502 }); }
  }

  /** Verbindung prüfen, bevor sie gespeichert wird. */
  async test(cfg) {
    const c = { url: String(cfg.url || '').replace(/\/+$/, ''), key: cfg.key || '', insecure: !!cfg.insecure };
    const ping = await this.call('/api/server/ping', { cfg: { ...c, key: '' } });
    if (ping?.res !== 'pong') throw Object.assign(new Error('Unter dieser Adresse antwortet kein Immich-Server'), { status: 400 });
    let version = null;
    try { const v = await this.call('/api/server/version', { cfg: c }); version = `${v.major}.${v.minor}.${v.patch}`; } catch { /* ältere Versionen */ }
    const me = await this.call('/api/users/me', { cfg: c });
    return { ok: true, user: me.name || me.email, version };
  }

  async albums() {
    const own = await this.call('/api/albums');
    let shared = [];
    try { shared = await this.call('/api/albums?shared=true'); } catch { /* egal */ }
    const all = new Map();
    for (const a of [...own, ...shared]) all.set(a.id, { id: a.id, name: a.albumName, count: a.assetCount ?? a.assets?.length ?? 0, thumb: a.albumThumbnailAssetId || null });
    return [...all.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  static map(a) {
    return {
      id: a.id,
      date: a.localDateTime || a.exifInfo?.dateTimeOriginal || a.fileCreatedAt || null,
      city: a.exifInfo?.city || null,
      w: a.exifInfo?.exifImageWidth || null, h: a.exifInfo?.exifImageHeight || null,
      fav: !!a.isFavorite,
    };
  }
  static usable(a) { return a && (a.type === 'IMAGE' || !a.type) && !a.isTrashed && !a.isArchived && a.visibility !== 'archive' && a.visibility !== 'hidden'; }

  async search(body) {
    const r = await this.call('/api/search/metadata', { method: 'POST', body: { type: 'IMAGE', withExif: true, size: 250, ...body } });
    return r?.assets?.items || [];
  }

  /**
   * @param source 'random' | 'favorites' | 'recent' | 'memories' | 'albums'
   * @param albumIds bei source = 'albums'
   */
  async photos({ source = 'random', albumIds = [], limit = 80 } = {}) {
    const key = `${source}:${albumIds.join(',')}`;
    const hit = this.cache.get(key);
    const fresh = hit && Date.now() - hit.at < (source === 'random' ? 3 : 15) * 60e3;
    let list = fresh ? hit.items : null;
    if (!list) {
      let assets = [];
      if (source === 'favorites') assets = await this.search({ isFavorite: true });
      else if (source === 'recent') assets = await this.search({ order: 'desc', size: 200 });
      else if (source === 'memories') {
        const now = new Date(); const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        for (let y = 1; y <= 20; y++) {
          const year = now.getFullYear() - y;
          // ± 3 Tage um das heutige Datum herum, damit es auch an ruhigen Tagen Bilder gibt
          const from = new Date(`${year}-${md}T00:00:00`); from.setDate(from.getDate() - 3);
          const to = new Date(`${year}-${md}T23:59:59`); to.setDate(to.getDate() + 3);
          try { assets.push(...await this.search({ takenAfter: from.toISOString(), takenBefore: to.toISOString(), size: 40 })); } catch { break; }
        }
      } else if (source === 'albums' && albumIds.length) {
        for (const id of albumIds.slice(0, 20)) {
          let items = [];
          try { const a = await this.call(`/api/albums/${encodeURIComponent(id)}`); items = a.assets || []; } catch { /* weiter */ }
          if (!items.length) { try { items = await this.search({ albumIds: [id], size: 500 }); } catch { /* ältere Versionen */ } }
          assets.push(...items);
        }
      } else {
        const r = await this.call('/api/search/random', { method: 'POST', body: { size: 120, type: 'IMAGE', withExif: true } });
        assets = Array.isArray(r) ? r : r?.assets?.items || [];
      }
      const seen = new Set();
      list = assets.filter(Immich.usable).filter((a) => !seen.has(a.id) && seen.add(a.id)).map(Immich.map);
      this.cache.set(key, { at: Date.now(), items: list });
    }
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    return source === 'recent' ? list.slice(0, limit) : shuffled.slice(0, limit);
  }

  async image(id, size = 'preview') {
    const r = await this.call(`/api/assets/${id}/thumbnail?size=${size === 'thumbnail' ? 'thumbnail' : 'preview'}`, { binary: true });
    return { type: r.headers['content-type'] || 'image/jpeg', body: r.body };
  }
}
