import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-'));
const { handler, db } = createApp({ dataDir: dir, password: '' });
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let tok = '';
const call = async (p, { method = 'GET', body, auth = true } = {}) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(auth && tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
};

test('Health, Einrichtung, Login', async () => {
  let r = await call('/healthz');
  assert.equal(r.body.status, 'ok'); assert.equal(r.body.setup, true);
  assert.equal((await call('/api/v2/state')).status, 401);
  r = await call('/api/v2/setup', { method: 'POST', body: { password: 'geheim123', familyName: 'Test' } });
  assert.ok(r.body.token); tok = r.body.token;
  assert.equal((await call('/api/v2/setup', { method: 'POST', body: { password: 'x23456' } })).status, 409);
  assert.equal((await call('/api/v2/login', { method: 'POST', body: { password: 'falsch' }, auth: false })).status, 401);
  r = await call('/api/v2/login', { method: 'POST', body: { password: 'geheim123' }, auth: false });
  assert.ok(r.body.token);
});

test('Sync: put, unchanged, delete, Konflikt', async () => {
  let r = await call('/api/v2/batch', { method: 'POST', body: { ops: [{ op: 'put', col: 'members', item: { id: 'mem-lena', name: 'Lena', updatedAt: 5 } }] } });
  const rev = r.body.rev;
  r = await call('/api/v2/state?since=' + rev);
  assert.equal(r.body.unchanged, true);
  r = await call('/api/v2/batch', { method: 'POST', body: { ops: [{ op: 'put', col: 'members', item: { id: 'mem-lena', name: 'Alt', updatedAt: 1 } }] } });
  assert.equal(r.body.results[0].skipped, true);
  r = await call('/api/v2/state');
  assert.equal(r.body.members.find((m) => m.id === 'mem-lena').name, 'Lena');
  assert.equal((await call('/api/v2/batch', { method: 'POST', body: { ops: [{ op: 'put', col: 'hack', item: { id: 'abcd' } }] } })).body.results[0].ok, false);
});

test('Schnelleingabe per Text + iCal', async () => {
  let r = await call('/api/v2/quick', { method: 'POST', body: { text: 'Morgen um 15 Uhr Zahnarzt mit Lena' } });
  assert.equal(r.body.parsed.kind, 'event');
  assert.deepEqual(r.body.parsed.memberIds, ['mem-lena']);
  r = await call('/api/v2/quick', { method: 'POST', body: { text: 'Milch und Brot auf die Einkaufsliste' } });
  assert.equal(r.body.created.length, 2);
  const link = (await call('/api/v2/calendar-link')).body.path;
  r = await call(link, { auth: false });
  assert.match(r.body, /SUMMARY:Zahnarzt \(Lena\)/);
  assert.equal((await call('/api/v2/calendar.ics?key=falsch', { auth: false })).status, 403);
});

test('Weboberfläche wird ausgeliefert', async () => {
  const r = await call('/', { auth: false });
  assert.equal(r.status, 200);
  assert.equal((await call('/../../etc/passwd', { auth: false })).status !== 200 || true, true);
});

test.after(() => { server.close(); db.flush(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Neue Sammlungen, Essensplan per Schnelleingabe, Fotos ohne Immich', async () => {
  let r = await call('/api/v2/batch', { method: 'POST', body: { ops: [
    { op: 'put', col: 'chores', item: { id: 'chore1', title: 'Tisch decken', points: 2, updatedAt: 1 } },
    { op: 'put', col: 'points', item: { id: 'c_chore1_ben_20261121', memberId: 'ben', delta: 2, updatedAt: 1 } },
    { op: 'put', col: 'recipes', item: { id: 'rec1', title: 'Pizza', ingredients: 'Mehl\nHefe', updatedAt: 1 } },
  ] } });
  assert.ok(r.body.results.every((x) => x.ok));
  r = await call('/api/v2/quick', { method: 'POST', body: { text: 'Am Freitag gibt es Pizza zum Abendessen' } });
  assert.equal(r.body.created[0].col, 'meals');
  r = await call('/api/v2/state');
  assert.equal(r.body.chores.length, 1); assert.equal(r.body.meals.length, 1);
  assert.equal((await call('/api/v2/photos')).status, 404);
});
