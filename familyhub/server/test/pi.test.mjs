import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { Db } from '../lib/db.js';
import { startMockImmich, KEY, PNG } from './mock-immich.mjs';

test('SQLite: Umzug aus familyhub.json, Speichern, Neustart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhdb-'));
  fs.writeFileSync(path.join(dir, 'familyhub.json'), JSON.stringify({ schema: 4, rev: 7, members: { a1: { id: 'a1', name: 'Alt', updatedAt: 1 } }, settings: { familyName: 'Test' }, auth: { passwordHash: 'x', salt: 'y', tokens: {} } }));
  let db = new Db(dir);
  assert.equal(db.kind, 'sqlite');
  assert.equal(db.data.members.a1.name, 'Alt');
  assert.equal(db.data.rev, 7);
  assert.ok(fs.existsSync(path.join(dir, 'familyhub.json.migrated')));
  db.apply([{ op: 'put', col: 'contacts', item: { id: 'k1', name: 'Kinderarzt', updatedAt: 5 } }, { op: 'del', col: 'members', id: 'a1' }]);
  db.data.secrets.immich = { url: 'http://x', key: 'geheim' };
  db.close();
  db = new Db(dir);
  assert.equal(db.data.contacts.k1.name, 'Kinderarzt');
  assert.equal(db.data.members.a1.deleted, true);
  assert.equal(db.data.rev, 8);
  assert.equal(db.data.secrets.immich.key, 'geheim');
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.endsWith('.sqlite')));
  assert.ok(!JSON.stringify(db.publicState()).includes('geheim'), 'Schlüssel darf nie an Geräte gehen');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Immich verbinden, Alben, Quellen, Bilder', async () => {
  const im = await startMockImmich();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhim-'));
  const { handler, db } = createApp({ dataDir: dir, password: 'geheim123', immichUrl: '', immichKey: '' });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tok = (await (await fetch(base + '/api/v2/login', { method: 'POST', body: JSON.stringify({ password: 'geheim123' }) })).json()).token;
  const call = async (p, body) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  try {
    assert.equal((await call('/api/v2/photos')).status, 404);
    let r = await call('/api/v2/immich', { url: im.url, key: 'falsch' });
    assert.equal(r.status, 502); assert.match(r.body.error, /API-Schlüssel/);
    r = await call('/api/v2/immich', { url: im.url + '/', key: KEY });
    assert.equal(r.body.configured, true); assert.equal(r.body.version, '1.135.3');
    // Foto-Diagnose: alle Schritte grün
    let d = await call('/api/v2/immich/check');
    assert.deepEqual(d.body.steps.map((s) => [s.name, s.ok]), [['Verbindung eingerichtet', true], ['Immich erreichbar', true], ['API-Schlüssel gültig', true], ['Fotos auflisten (asset.read)', true], ['Vorschaubild laden (asset.view)', true], ['Album „Familien-Diashow“', true]]);
    r = await call('/api/v2/immich');
    assert.equal(r.body.configured, true); assert.equal(r.body.key, undefined);
    r = await call('/api/v2/photo-albums');
    assert.deepEqual(r.body.albums.map((a) => a.name), ['Familien-Diashow', 'Geteilt', 'Urlaub 2025']);
    assert.deepEqual(r.body.family, { ids: ['00000000-0000-4000-8000-000000000902'], names: ['Familien-Diashow'], count: 4, auto: true }); // automatisch erkannt
    r = await call('/api/v2/photos?source=random&limit=50');
    assert.equal(r.body.items.length, 28); // ohne Video und Archiv
    const key = r.body.key;
    r = await call('/api/v2/photos?source=favorites');
    assert.equal(r.body.items.length, 5);
    r = await call(`/api/v2/photos?source=albums&albums=00000000-0000-4000-8000-000000000900,00000000-0000-4000-8000-000000000901`);
    assert.equal(r.body.items.length, 5); // 3 aus dem Album + 2 über die Suche (ältere/neuere API)
    // Standard-Quelle „Familien-Diashow“: nur Fotos aus diesem Album
    r = await call('/api/v2/photos?source=family&limit=50');
    assert.equal(r.body.items.length, 4); assert.equal(r.body.family.names[0], 'Familien-Diashow'); assert.ok(!r.body.fallback);
    // Familien-Standard bewusst auf ein anderes Album setzen – gilt dann für alle Geräte
    r = await call('/api/v2/photo-family', { albums: ['00000000-0000-4000-8000-000000000900'] });
    assert.deepEqual(r.body.family.names, ['Urlaub 2025']); assert.equal(r.body.family.auto, false);
    r = await call('/api/v2/photos?source=family&limit=50'); assert.equal(r.body.items.length, 3);
    await call('/api/v2/photo-family', { albums: [] }); // zurück auf automatisch
    r = await call('/api/v2/photos?source=memories');
    assert.ok(r.body.items.length > 0 && r.body.items.every((x) => x.date.slice(5, 7) === '11'));
    const img = await fetch(`${base}/api/v2/photos/00000000-0000-4000-8000-000000000001?key=${key}&size=thumbnail`);
    assert.equal(img.status, 200); assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
    assert.equal((await fetch(`${base}/api/v2/photos/00000000-0000-4000-8000-000000000001?key=falsch`)).status, 403);
    const denied = await fetch(`${base}/api/v2/photos/00000000-0000-4000-8000-000000000999?key=${key}&size=thumbnail`);
    assert.equal(denied.status, 502); assert.match((await denied.json()).error, /asset\.view/); // verständlicher Hinweis statt leerer Kachel
    assert.ok(!JSON.stringify((await call('/api/v2/state')).body).includes(KEY));
    r = await call('/api/v2/server-info'); assert.equal(r.body.db.kind, 'sqlite');
  } finally { server.close(); im.srv.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Dokumente hochladen, abrufen, löschen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhdoc-'));
  const { handler, db } = createApp({ dataDir: dir, password: 'geheim123' });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tok = (await (await fetch(base + '/api/v2/login', { method: 'POST', body: JSON.stringify({ password: 'geheim123' }) })).json()).token;
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/v2/files', { name: 'x.exe', type: 'application/x-msdownload', data: 'AAAA' })).status, 415);
    const pdf = Buffer.from('%PDF-1.4 Impfpass');
    const r = await (await post('/api/v2/files', { name: 'Impfpass Lena.pdf', type: 'application/pdf', data: pdf.toString('base64') })).json();
    assert.ok(r.fileId && r.key);
    const g = await fetch(`${base}/api/v2/files/${r.fileId}?key=${r.key}`);
    assert.equal(g.headers.get('content-type'), 'application/pdf');
    assert.deepEqual(Buffer.from(await g.arrayBuffer()), pdf);
    assert.equal((await fetch(`${base}/api/v2/files/${r.fileId}?key=falsch`)).status, 403);
    assert.equal((await fetch(`${base}/api/v2/files/..%2F..%2Fetc?key=${r.key}`)).status, 400);
    await post(`/api/v2/files/${r.fileId}/delete`, {});
    assert.equal((await fetch(`${base}/api/v2/files/${r.fileId}?key=${r.key}`)).status, 404);
  } finally { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
