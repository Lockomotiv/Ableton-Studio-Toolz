// FamilyHub auf dem iPhone (und jedem Browser): als Web-App vom Pi, mit Push-Benachrichtigungen und Siri-Kurzbefehl.
import { h, icon, toast } from './ui.js';
import { store, webOrigin } from './store.js';
import { member, members } from './domain.js';
import { isApp, copy } from './native.js';

export const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyToBytes(b64) { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); }

export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try { const reg = await navigator.serviceWorker.getRegistration(); const sub = await reg?.pushManager.getSubscription(); return sub ? 'on' : 'off'; } catch { return 'off'; }
}

/** Benachrichtigungen auf diesem Gerät einschalten (Abo beim Pi hinterlegen) */
export async function enablePush() {
  if (!pushSupported()) throw new Error(isIOS && !isStandalone() ? 'Auf dem iPhone gehen Benachrichtigungen nur, wenn FamilyHub zum Home-Bildschirm hinzugefügt wurde (Teilen → „Zum Home-Bildschirm“) und von dort geöffnet wird.' : 'Dieser Browser unterstützt keine Push-Benachrichtigungen.');
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') throw new Error('Benachrichtigungen brauchen eine sichere Verbindung (https://). Am einfachsten über Tailscale – siehe Anleitung.');
  if (!store.serverEnabled()) throw new Error('Bitte zuerst mit dem Pi verbinden.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt (Einstellungen → Mitteilungen → FamilyHub).');
  const reg = await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  const { publicKey } = await store.request('api/v2/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  await store.request('api/v2/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), memberId: store.config.meId || null, device: isIOS ? 'iPhone' : 'Browser', test: true } });
  store.saveConfig({ pushEnabled: true });
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { try { await store.request('api/v2/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); } catch { /* egal */ } await sub.unsubscribe(); }
  store.saveConfig({ pushEnabled: false });
}

/** Hinweis auf „Heute“, solange FamilyHub im iPhone-Safari (nicht als App) läuft */
export function installBanner() {
  if (isApp || !isIOS || isStandalone() || store.config.hideInstallHint) return null;
  return h('a.card.install-banner', { href: '#iphone' }, h('span.ib-icon', null, '📲'), h('span.ib-text', null, h('b', null, 'FamilyHub als App aufs iPhone'), h('small', null, 'Teilen ⬆︎ → „Zum Home-Bildschirm“ – dann mit Benachrichtigungen')), icon('right', 18));
}

// ================= Anleitung & Einrichtung =================
export function viewIphone() {
  const page = h('div.page');
  const https = location.protocol === 'https:';
  const me = member(store.config.meId);
  const step = (ok, title, body) => h('div.ios-step' + (ok ? '.ok' : ''), null, h('span.ios-check', null, ok ? '✓' : ''), h('div', null, h('b', null, title), body));
  const pushBox = h('div');
  const drawPush = async () => {
    const st = await pushState();
    pushBox.replaceChildren(st === 'on'
      ? h('div.btn-row.wrap', null, h('span.status.ok', null, '● Benachrichtigungen aktiv'), h('button.btn.small.ghost', { onclick: async () => { await disablePush(); drawPush(); } }, 'Ausschalten'))
      : h('button.btn.primary', { onclick: async () => { try { await enablePush(); toast('Benachrichtigungen aktiv – Test kommt gleich 🔔'); } catch (e) { toast(e.message); } drawPush(); } }, '🔔 Benachrichtigungen einschalten'),
    st === 'denied' ? h('p.hint', null, 'Blockiert: iPhone-Einstellungen → Mitteilungen → FamilyHub → Mitteilungen erlauben.') : null);
  };
  drawPush();
  const pi = store.config.server;
  const tsAddr = (pi.mobile || '').replace(/^http:/, 'https:');
  page.append(
    h('div.page-head', null, h('a.icon-btn', { href: '#mehr', 'aria-label': 'Zurück' }, icon('left')), h('h1', null, 'iPhone & Browser')),
    h('p.muted', null, 'Auf iPhones läuft FamilyHub als Web-App direkt vom Pi – ohne App Store. Alle sehen dieselben Termine, Aufgaben, Einkäufe und Fotos wie auf den Android-Handys.'),
    isApp ? h('div.card', null, h('b', null, 'So kommt FamilyHub aufs iPhone'),
      h('ol.tips', null,
        h('li', null, 'Auf dem iPhone die App „Tailscale“ installieren und mit eurem Konto anmelden.'),
        h('li', null, 'In Safari öffnen: ', h('code', null, tsAddr || 'https://<pi-name>.ts.net:8446/'), ' (die sichere Adresse über Tailscale – nötig für Mikrofon & Benachrichtigungen).'),
        h('li', null, 'Teilen ⬆︎ → „Zum Home-Bildschirm“.'),
        h('li', null, 'Vom Home-Bildschirm öffnen, anmelden (Familien-Passwort), unter Familie „Wer nutzt dieses Handy?“ wählen.'),
        h('li', null, 'Hier unter „iPhone & Browser“ die Benachrichtigungen einschalten.')),
      h('button.btn.tonal', { onclick: () => { copy(tsAddr); toast('Adresse kopiert'); } }, 'Adresse kopieren'))
      : h('div.ios-steps', null,
        step(https, 'Sichere Verbindung (https)', https ? h('small', null, location.host) : h('small', null, `Jetzt: ${location.host}. Für Mikrofon & Benachrichtigungen die Tailscale-Adresse nutzen: ${tsAddr || 'https://<pi-name>.ts.net:8446/'}`)),
        step(isStandalone(), 'Zum Home-Bildschirm hinzugefügt', isStandalone() ? h('small', null, 'FamilyHub läuft als App') : h('small', null, 'In Safari: Teilen ⬆︎ → „Zum Home-Bildschirm“ → Hinzufügen. Danach FamilyHub vom Home-Bildschirm aus öffnen.')),
        step(store.serverEnabled(), 'Mit dem Pi angemeldet', store.serverEnabled() ? h('small', null, 'Daten werden abgeglichen') : h('a', { href: '#sync' }, 'Jetzt anmelden')),
        step(!!me, 'Wer nutzt dieses iPhone?', me ? h('small', null, me.name) : h('a', { href: '#familie' }, 'Unter „Familie“ auswählen – damit Erinnerungen nur für dich kommen')),
        h('div.ios-step', null, h('span.ios-check', null, '🔔'), h('div', null, h('b', null, 'Benachrichtigungen'), h('small', null, 'Erinnerungen an Termine & Aufgaben, Abfall am Vorabend, neue Nachrichten – verschickt direkt vom Pi.'), pushBox))),
    siriSection(),
    h('section.section', null, h('h3.section-title', null, 'Gut zu wissen'), h('ul.tips', null,
      h('li', null, 'Spracheingabe: das Mikrofon in FamilyHub nutzen – oder die Diktier-Taste 🎤 der iPhone-Tastatur im Eingabefeld.'),
      h('li', null, 'Fotos, Diashow, Abfall, Pinnwand … funktionieren genauso wie auf Android.'),
      h('li', null, 'Erinnerungen kommen vom Pi – der Pi muss also laufen (tut er ja sowieso).'))));
  return page;
}

function siriSection() {
  const box = h('div');
  const base = webOrigin || store.config.server.active || store.config.server.home;
  const me = store.config.meId;
  box.append(h('button.btn.tonal', { onclick: async () => {
    if (!store.serverEnabled()) return toast('Bitte zuerst mit dem Pi verbinden.');
    try {
      const { token } = await store.request('api/v2/tokens', { method: 'POST', body: { name: 'Siri-Kurzbefehl' + (me ? ' · ' + (member(me)?.name || '') : '') } });
      const url = (base || '').replace(/\/?$/, '/') + 'api/v2/quick';
      const body = JSON.stringify({ text: '<Diktierter Text>', memberId: me || members()[0]?.id || '' });
      const field = (label, val) => h('div.copy-field', null, h('small', null, label), h('code.url', null, val), h('button.btn.small.ghost', { onclick: () => { copy(val); toast('Kopiert'); } }, 'Kopieren'));
      box.replaceChildren(
        h('ol.tips', null,
          h('li', null, 'App „Kurzbefehle“ öffnen → „+“ → Name: „FamilyHub“.'),
          h('li', null, 'Aktion „Text diktieren“ hinzufügen (Sprache: Deutsch).'),
          h('li', null, 'Aktion „Inhalte von URL abrufen“: URL unten einfügen, Methode „POST“, Header „Authorization“ = Wert unten, Anfragetext „JSON“ mit Feld „text“ = Diktierter Text und Feld „memberId“ = Wert unten.'),
          h('li', null, 'Aktion „Wörterbuchwert abrufen“: Schlüssel „speak“.'),
          h('li', null, 'Aktion „Text sprechen“ → Wörterbuchwert.'),
          h('li', null, 'Fertig: „Hey Siri, FamilyHub“ → „Morgen um 15 Uhr Zahnarzt mit Lena“ oder „Was steht heute an?“')),
        field('URL', url), field('Header „Authorization“', 'Bearer ' + token), field('memberId', JSON.parse(body).memberId),
        h('p.hint', null, 'Der Schlüssel gilt nur für FamilyHub und kann unter Synchronisierung → Passwort ändern jederzeit ungültig gemacht werden.'));
    } catch (e) { toast(e.message); }
  } }, '🎙️ Siri-Kurzbefehl einrichten'));
  return h('section.section', null, h('h3.section-title', null, '„Hey Siri, FamilyHub“'),
    h('p.muted', null, 'Mit einem Kurzbefehl trägt Siri Termine, Aufgaben und Einkäufe direkt beim Pi ein und beantwortet Fragen wie „Welcher Müll kommt morgen?“ – auch vom Sperrbildschirm, der Apple Watch oder CarPlay.'), box);
}
