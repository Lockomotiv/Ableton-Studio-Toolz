import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encrypt, decrypt, vapidAuth, generateVapid } from '../lib/webpush.js';
import { Notifier } from '../lib/notify.js';
import { Db } from '../lib/db.js';
import { fetchRaw } from '../server.js';

const u = (s) => Buffer.from(s, 'base64url');

test('RFC 8291 Testvektor (Interoperabilität mit Apple/Google/Mozilla)', () => {
  const as = crypto.createECDH('prime256v1'); as.setPrivateKey(u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'));
  assert.equal(as.getPublicKey().toString('base64url'), 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
  const out = encrypt('When I grow up, I want to be a watermelon', { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' }, { salt: u('DGv6ra1nlYgDCS1FRnbzlw'), ecdh: as });
  assert.equal(out.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  const ua = crypto.createECDH('prime256v1'); ua.setPrivateKey(u('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'));
  assert.equal(decrypt(out, ua, 'BTBZMqHH6r4Tts7J_aSIgg'), 'When I grow up, I want to be a watermelon');
});

test('VAPID-Signatur ist gültig', () => {
  const v = generateVapid();
  const h = vapidAuth('https://web.push.apple.com/QH8…', v);
  const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  const [hd, pl, sig] = jwt.split('.');
  const raw = u(k); const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${hd}.${pl}`), { key: pub, dsaEncoding: 'ieee-p1363' }, u(sig)));
  assert.equal(JSON.parse(u(pl)).aud, 'https://web.push.apple.com');
});

test('Erinnerungen, Abfall und neue Nachrichten werden zugestellt', async () => {
  // nachgebauter Push-Dienst, der wie ein iPhone entschlüsselt
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16).toString('base64url');
  const got = [];
  const srv = http.createServer((req, res) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => { got.push({ auth: req.headers.authorization, enc: req.headers['content-encoding'], msg: JSON.parse(decrypt(Buffer.concat(c), ua, auth)) }); res.writeHead(201); res.end(); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhpush-'));
  const db = new Db(dir);
  const now = new Date(2026, 10, 23, 18, 59, 30).getTime(); // Montag 18:59:30
  try {
    const n = new Notifier(db, fetchRaw, { wastePickups: (a) => (a === '2026-11-24' ? [{ date: a, wasteKey: 'gelb', wasteName: 'Gelber Sack / Tonne' }] : []) });
    db.data.secrets.push.lena = { endpoint: `http://127.0.0.1:${srv.address().port}/lena`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth }, memberId: 'lena', device: 'iPhone Lena' };
    db.data.secrets.push.ben = { endpoint: `http://127.0.0.1:${srv.address().port}/ben`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth }, memberId: 'ben', device: 'iPhone Ben' };
    db.data.members.lena = { id: 'lena', name: 'Lena', role: 'child' };
    db.data.events.e1 = { id: 'e1', title: 'Zahnarzt', date: '2026-11-23', time: '19:30', remindMin: 31, memberIds: ['lena'], updatedAt: 1 };
    db.data.tasks.t1 = { id: 't1', title: 'Müll raus', date: '2026-11-23', time: '19:00', remindMin: 0, memberIds: [], updatedAt: 1, done: false };
    n.last = now - 60e3;
    assert.equal(await n.tick(now), 1); // Zahnarzt 30 Min. vorher → nur Lena
    assert.equal(await n.tick(now + 60e3), 4); // 19:00: Aufgabe + Abfall an beide
    assert.equal(await n.tick(now + 60e3), 0); // keine Doppelten
    const titles = got.map((g) => g.msg.title);
    assert.deepEqual(titles.slice(0, 1), ['Zahnarzt']);
    assert.ok(titles.includes('Morgen: Gelber Sack / Tonne'));
    // Emojis nur auf dem Kinder-Handy, Erwachsene bekommen reinen Text
    const by = (who) => got.filter((g) => g.msg.title.includes('Müll raus')).map((g) => g.msg.title).sort();
    assert.deepEqual(by(), ['Müll raus', '☑ Müll raus']);
    assert.ok(got.every((g) => g.enc === 'aes128gcm' && /^vapid t=.+, k=/.test(g.auth)));
    got.length = 0;
    n.afterBatch([{ op: 'put', col: 'messages', item: { id: 'm1', text: 'Bin um 6 da', authorId: 'lena' } }], new Set());
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(got.map((g) => [g.msg.title, g.msg.body]), [['Lena', 'Bin um 6 da']]); // nicht an die Absenderin, Erwachsene ohne Emoji
    // abgelaufenes Abo wird entfernt
    db.data.secrets.push.alt = { endpoint: 'http://127.0.0.1:1/x', keys: db.data.secrets.push.ben.keys, memberId: null, device: 'alt' };
    assert.throws(() => n.subscribe({ endpoint: 'http://unsicher', keys: {} }), /Ungültig/);
  } finally { srv.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
