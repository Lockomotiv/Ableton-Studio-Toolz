// Brücke zur Android-App. Im Browser fällt alles auf Web-APIs zurück.
const N = typeof window !== 'undefined' ? window.FHNative : undefined;
export const isApp = !!N;

let seq = 0;
const pending = new Map();
if (typeof window !== 'undefined') {
  window.__fhNativeCb = (id, json) => {
    const p = pending.get(id); if (!p) return;
    pending.delete(id);
    try { p.resolve(typeof json === 'string' ? JSON.parse(json) : json); } catch (e) { p.reject(e); }
  };
}

export function info() {
  if (!N) return { platform: 'web', version: null };
  try { return JSON.parse(N.info()); } catch { return { platform: 'android' }; }
}

/**
 * HTTP-Anfrage. In der App über die native Schicht (kein CORS, eigene Zertifikate des Handys gelten),
 * im Browser über fetch.
 */
export async function http(url, { method = 'GET', headers = {}, body, timeout = 8000 } = {}) {
  if (N && N.http) {
    const id = 'r' + (++seq);
    const res = await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      N.http(id, JSON.stringify({ url, method, headers, body: body == null ? null : typeof body === 'string' ? body : JSON.stringify(body), timeout }));
    });
    if (res.error) throw Object.assign(new Error(res.error), { network: true, kind: res.kind });
    let data = res.body;
    try { data = JSON.parse(res.body); } catch { /* Text */ }
    return { status: res.status, data, headers: res.headers || {} };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { method, headers: { ...(body != null ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body), signal: ctrl.signal, cache: 'no-store' });
    const txt = await r.text();
    let data = txt; try { data = JSON.parse(txt); } catch { /* Text */ }
    return { status: r.status, data, headers: {} };
  } catch (e) {
    throw Object.assign(new Error(e.name === 'AbortError' ? 'Zeitüberschreitung' : 'Keine Verbindung'), { network: true, kind: e.name === 'AbortError' ? 'timeout' : 'connect' });
  } finally { clearTimeout(t); }
}

export function openUrl(url) { if (N) N.openUrl(url); else if (/^(tel|sms|mailto|geo):/.test(url)) location.href = url; else window.open(url, '_blank', 'noopener'); }
export function openApp(pkg, fallbackUrl) { if (N && N.openApp(pkg)) return true; if (fallbackUrl) openUrl(fallbackUrl); return false; }
export function haptic(kind = 'tick') { try { if (N) N.haptic(kind); else navigator.vibrate?.(kind === 'success' ? [10, 40, 10] : 8); } catch { /* egal */ } }
export function speak(text) {
  if (N && N.speak) return N.speak(text);
  try { const u = new SpeechSynthesisUtterance(text); u.lang = 'de-DE'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* egal */ }
}
export function scheduleReminders(items) { if (N && N.scheduleReminders) N.scheduleReminders(JSON.stringify(items)); }
export function updateWidget(summary) { if (N && N.updateWidget) N.updateWidget(JSON.stringify(summary)); }
export function requestNotifications() { if (N && N.requestNotifications) N.requestNotifications(); else if ('Notification' in window) Notification.requestPermission(); }
export function share(text) { if (N && N.share) N.share(text); else if (navigator.share) navigator.share({ text }).catch(() => {}); else navigator.clipboard?.writeText(text); }
export function copy(text) { if (N && N.copy) N.copy(text); else navigator.clipboard?.writeText(text); }
export function consumeLaunchAction() { try { return N && N.consumeLaunchAction ? N.consumeLaunchAction() : new URLSearchParams(location.search).get('action') || ''; } catch { return ''; } }
export function setChildLock(on) { if (N && N.setChildLock) N.setChildLock(!!on); }
export function moveToBack() { if (N && N.moveToBack) N.moveToBack(); }
export function saveFile(name, text) {
  if (N && N.saveFile) return N.saveFile(name, text);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function pickFile() {
  return new Promise((resolve) => {
    if (N && N.pickFile) { window.__fhFile = (txt) => resolve(txt); N.pickFile(); return; }
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json,.json';
    i.onchange = () => { const f = i.files[0]; if (!f) return resolve(null); f.text().then(resolve); };
    i.click();
  });
}
export function notify(title, body) {
  if (N && N.notify) return N.notify(title, body || '');
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body }); } catch { /* egal */ }
}
