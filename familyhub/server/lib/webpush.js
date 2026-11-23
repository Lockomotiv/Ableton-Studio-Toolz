// Web Push ohne Zusatzpakete: VAPID (RFC 8292) + Verschlüsselung "aes128gcm" (RFC 8291 / RFC 8188).
// Damit schickt der Pi Benachrichtigungen an iPhones (Home-Bildschirm-App, iOS ≥ 16.4), Android-Browser und Desktop-Browser.
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

/** Neues VAPID-Schlüsselpaar (einmalig, wird in der Datenbank gespeichert) */
export function generateVapid() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]);
  return { publicKey: b64u(raw), privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) };
}

/** VAPID-JWT für den Push-Dienst (Apple, Google, Mozilla …) */
export function vapidAuth(endpoint, vapid, subject = 'https://github.com/Lockomotiv/Ableton-Studio-Toolz') {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const data = `${header}.${payload}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: vapid.privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64u(sig)}, k=${vapid.publicKey}`;
}

const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

/** Nachricht für ein Abo verschlüsseln (RFC 8291). */
export function encrypt(payload, keys, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const uaPublic = fromB64u(keys.p256dh);
  const authSecret = fromB64u(keys.auth);
  const as = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) as.generateKeys();
  const asPublic = as.getPublicKey();
  const shared = as.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

/** Gegenstück (für Tests): so entschlüsselt der Browser */
export function decrypt(buf, uaEcdh, authSecretB64) {
  const salt = buf.subarray(0, 16); const idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen); const ct = buf.subarray(21 + idlen);
  const shared = uaEcdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic]);
  const ikm = hkdf(fromB64u(authSecretB64), shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString('utf8');
}

/**
 * Benachrichtigung senden.
 * @returns {status} – 201/200 ok; 404/410 = Abo ungültig (löschen)
 */
export async function sendPush(sub, message, vapid, fetchRaw, { ttl = 86400, urgency = 'normal', topic } = {}) {
  const body = encrypt(JSON.stringify(message), sub.keys);
  const headers = {
    TTL: String(ttl), Urgency: urgency, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    'Content-Length': String(body.length), Authorization: vapidAuth(sub.endpoint, vapid),
    ...(topic ? { Topic: topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
  };
  const r = await fetchRaw(sub.endpoint, { method: 'POST', headers, body, timeout: 15000 });
  return { status: r.status, body: r.body?.toString('utf8').slice(0, 300) };
}
