// Nachgebauter Immich-Server für Tests (Pfade und Antwortformate wie Immich 1.12x–2.x)
import http from 'node:http';
import zlib from 'node:zlib';
export const KEY = 'test-api-key';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const assets = Array.from({ length: 30 }, (_, i) => ({
  id: id(i + 1), type: i === 29 ? 'VIDEO' : 'IMAGE', isFavorite: i < 5, isArchived: i === 28, isTrashed: false,
  localDateTime: `20${15 + (i % 10)}-11-23T10:00:00.000Z`, exifInfo: { city: i % 2 ? 'Graz' : 'Berlin' },
}));
// echtes PNG mit Farbverlauf, Farbe abhängig von der Bild-ID
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
export function pngFor(seed, w = 480, h = 320) {
  const hue = (seed * 47) % 360; const f = (n, k = (n + hue / 30) % 12) => 0.5 - 0.45 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  const [r, g, b] = [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const t = (x / w + y / h) / 2; raw[o] = r * (1 - t * 0.6); raw[o + 1] = g * (1 - t * 0.4); raw[o + 2] = Math.min(255, b + t * 80); } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const PNG = pngFor(1);
export function startMockImmich() {
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/api/server/ping') return json({ res: 'pong' });
    if (req.headers['x-api-key'] !== KEY) return json({ message: 'Invalid API key' }, 401);
    let body = ''; for await (const c of req) body += c; body = body ? JSON.parse(body) : {};
    if (u.pathname === '/api/server/version') return json({ major: 1, minor: 135, patch: 3 });
    if (u.pathname === '/api/users/me') return json({ name: 'Familie', email: 'f@x' });
    if (u.pathname === '/api/albums') return json(u.searchParams.get('shared') ? [{ id: id(901), albumName: 'Geteilt', assetCount: 2 }] : [{ id: id(900), albumName: 'Urlaub 2025', assetCount: 3, albumThumbnailAssetId: id(1) }]);
    if (u.pathname === `/api/albums/${id(900)}`) return json({ id: id(900), assets: assets.slice(0, 3) });
    if (u.pathname === `/api/albums/${id(901)}`) return json({ id: id(901), assets: [] });
    if (u.pathname === '/api/search/random') return json(assets.slice(0, Math.min(body.size || 10, 30)));
    if (u.pathname === '/api/search/metadata') {
      let items = assets;
      if (body.isFavorite) items = items.filter((a) => a.isFavorite);
      if (body.albumIds) items = body.albumIds.includes(id(901)) ? assets.slice(10, 12) : [];
      if (body.takenAfter) items = items.filter((a) => a.localDateTime >= body.takenAfter && a.localDateTime <= body.takenBefore);
      return json({ assets: { items: items.slice(0, body.size || 250), nextPage: null } });
    }
    const m = u.pathname.match(/^\/api\/assets\/([0-9a-f-]+)\/thumbnail$/);
    if (m && m[1].endsWith('0999')) return json({ message: 'Missing required permission: asset.view' }, 403); // Schlüssel ohne asset.view
    if (m) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(pngFor(parseInt(m[1].slice(-4), 10) || 0)); }
    json({ message: 'not found' }, 404);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}
