// Eigener HTTPS-Zugang (Caddy): Passwort-Bremse pro echtem Absender, Kopfzeile nur aus dem Docker-Netz vertrauen
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

async function start(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhpx-'));
  const { handler, db } = createApp({ dataDir: dir, password: 'geheim123', ...opts });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = (pw, ip) => fetch(base + '/api/v2/login', { method: 'POST', headers: ip ? { 'X-Forwarded-For': ip } : {}, body: JSON.stringify({ password: pw }) }).then((r) => r.status);
  return { login, stop: () => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('Hinter dem Proxy: Fehlversuche eines Angreifers sperren nicht die Familie', async () => {
  const s = await start({ trustProxy: true });
  try {
    for (let i = 0; i < 10; i++) await s.login('falsch', '203.0.113.9');
    assert.equal(await s.login('falsch', '203.0.113.9'), 429); // Angreifer gebremst
    assert.equal(await s.login('geheim123', '198.51.100.7'), 200); // Familie kommt weiter rein
  } finally { s.stop(); }
});

test('Ohne Proxy-Modus wird X-Forwarded-For ignoriert', async () => {
  const s = await start({ trustProxy: false });
  try {
    for (let i = 0; i < 10; i++) await s.login('falsch', `203.0.113.${i}`);
    assert.equal(await s.login('falsch', '198.51.100.1'), 429); // gefälschte Absender helfen nicht
  } finally { s.stop(); }
});
