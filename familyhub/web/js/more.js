// Bereich „Mehr“: Familie, Kindermodus, Fotos, Pi & Dienste, Synchronisierung, Einstellungen, Hilfe.
import { h, icon, toast, confirmSheet, promptSheet, sheet } from './ui.js';
import { store, normalizeBase } from './store.js';
import { members, childMode, refreshNative } from './domain.js';
import { editMember } from './editors.js';
import { http, openUrl, openApp, info, requestNotifications, saveFile, pickFile, copy, setChildLock, isApp } from './native.js';
import { openCapture } from './capture.js';
import { avatars } from './views.js';
import { calendars, refreshCalendar, calStatus } from './extcal.js';
import { openWall } from './wall.js';
import { MEMBER_COLORS } from './domain.js';

const APP_VERSION = '3.3.0';

function row(ic, title, sub, onclick, right) {
  return h(onclick ? 'button.menu-row' : 'div.menu-row', { onclick }, h('span.mi', null, icon(ic, 20)), h('span.mt', null, h('b', null, title), sub ? h('small', null, sub) : null), right || (onclick ? icon('right', 18) : null));
}
function back(title) { return h('div.page-head', null, h('a.icon-btn', { href: '#mehr', 'aria-label': 'Zurück' }, icon('left')), h('h1', null, title)); }
function status(el, text, kind) { el.textContent = text; el.className = 'status ' + (kind || ''); }

// ---------- Übersicht ----------
export function viewMore() {
  const s = store.config.server;
  const syncSub = store.serverEnabled() ? (store.sync.state === 'error' ? '⚠ ' + store.sync.error : `Verbunden · ${s.familyName || store.config.familyName}`) : 'Nur auf diesem Gerät gespeichert';
  return h('div.page.more', null,
    h('div.page-head', null, h('h1', null, 'Mehr')),
    h('div.menu', null,
      row('users', 'Familie', members().length ? members().map((m) => m.name).join(', ') : 'Personen anlegen', () => go('familie'), avatars(members().map((m) => m.id))),
      row('lock', 'Kindermodus', store.config.child.pinHash ? 'Eingerichtet' : 'Vereinfachte Ansicht für Kinder', () => go('kinder')),
      row('photo', 'Fotos', 'Immich öffnen', () => go('fotos'))),
    h('div.menu', null,
      row('calendar', 'Kalender verbinden', calendars().length ? calendars().map((c) => c.name).join(', ') : 'Google, Apple, Outlook, Schulferien …', () => go('extern')),
      row('photo', 'Wandansicht & Bilderrahmen', 'Für ein Tablet an der Wand', () => openWall())),
    h('div.menu', null,
      row('sync', 'Synchronisierung', syncSub, () => go('sync')),
      row('server', 'Pi & Dienste', 'Status, Starten/Stoppen, Adressen', () => go('pi'))),
    h('div.menu', null,
      row('settings', 'Einstellungen', 'Darstellung, Sprache, Erinnerungen, Daten', () => go('einstellungen')),
      row('help', 'Sprachbefehle & Hilfe', 'Was FamilyHub versteht', () => go('hilfe'))),
    h('p.footnote', null, `FamilyHub ${APP_VERSION}`));
}
const go = (r) => { location.hash = r; };

// ---------- Familie ----------
export function viewFamily() {
  const ms = members();
  const me = store.config.meId;
  return h('div.page', null,
    back('Familie'),
    h('p.muted', null, 'Wer gehört dazu? Namen helfen der Sprachsteuerung („… mit Lena“), Farben machen den Kalender übersichtlich.'),
    h('div.menu', null, ...ms.map((m) => h('button.menu-row', { onclick: () => editMember(m) },
      h('span.av.lg', { style: { '--c': m.color } }, m.emoji || m.name[0]),
      h('span.mt', null, h('b', null, m.name, m.id === me ? h('span.badge', null, 'Ich') : null), h('small', null, { parent: 'Elternteil', child: 'Kind', other: 'Familie' }[m.role] || '')),
      icon('right', 18))),
    h('button.menu-row.add', { onclick: () => editMember(null) }, h('span.mi', null, icon('plus', 20)), h('span.mt', null, h('b', null, 'Person hinzufügen')))),
    ms.length ? h('div.card', null,
      h('b', null, 'Wer nutzt dieses Handy?'),
      h('p.muted', null, 'Erinnerungen kommen nur für eigene und gemeinsame Einträge. „Für mich“ in Sprachbefehlen meint diese Person.'),
      h('div.chips.people', null, ...ms.map((m) => h('button.person' + (m.id === me ? '.on' : ''), { style: { '--c': m.color }, onclick: () => { store.saveConfig({ meId: m.id === me ? null : m.id }); refreshNative(); } }, h('span.av', null, m.emoji || m.name[0]), m.name)))) : null);
}

// ---------- Kindermodus ----------
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fh-pin:' + s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }

export async function verifyParentPin(title = 'Eltern bestätigen') {
  if (!store.config.child.pinHash) return true;
  const pin = await promptSheet({ title, label: 'Eltern-PIN', type: 'password', ok: 'Bestätigen' });
  if (pin == null) return false;
  if (await sha(pin) !== store.config.child.pinHash) { toast('PIN stimmt nicht'); return false; }
  return true;
}

export async function exitChildMode() {
  if (!await verifyParentPin('Kindermodus verlassen')) return;
  store.saveConfig({ child: { activeMemberId: null } });
  setChildLock(false); refreshNative();
  toast('Kindermodus beendet'); location.hash = 'heute';
}

export function viewChild() {
  const kids = members().filter((m) => m.role === 'child');
  const c = store.config.child;
  return h('div.page', null,
    back('Kindermodus'),
    h('p.muted', null, 'Im Kindermodus sieht ein Kind nur seine eigenen Termine und Aufgaben, kann Aufgaben abhaken und per Sprache Neues eintragen. Einstellungen, Löschen und der Pi sind gesperrt.'),
    h('div.menu', null,
      row('lock', c.pinHash ? 'Eltern-PIN ändern' : 'Eltern-PIN festlegen', 'Zum Verlassen des Kindermodus', async () => {
        const p1 = await promptSheet({ title: 'Eltern-PIN', label: 'Neue PIN (mind. 4 Ziffern)', type: 'password' });
        if (!p1) return; if (!/^\d{4,8}$/.test(p1)) return toast('Bitte 4–8 Ziffern verwenden');
        const p2 = await promptSheet({ title: 'Eltern-PIN', label: 'PIN wiederholen', type: 'password' });
        if (p1 !== p2) return toast('PINs stimmen nicht überein');
        store.saveConfig({ child: { pinHash: await sha(p1) } }); toast('PIN gespeichert'); location.hash = 'kinder';
      })),
    kids.length ? h('div.menu', null, ...kids.map((k) => row('users', `Kindermodus für ${k.name} starten`, 'Dieses Handy wird für ' + k.name + ' eingeschränkt', async () => {
      if (!c.pinHash) return toast('Bitte zuerst eine Eltern-PIN festlegen');
      if (!await confirmSheet({ title: `Kindermodus für ${k.name}?`, text: 'Zum Verlassen wird die Eltern-PIN gebraucht.', ok: 'Starten' })) return;
      store.saveConfig({ child: { activeMemberId: k.id } }); setChildLock(true); refreshNative(); location.hash = 'heute';
    }))) : h('div.card.tip', null, h('p', null, 'Lege unter „Familie“ ein Kind an (Rolle „Kind“), um den Kindermodus zu nutzen.'), h('a.btn.tonal', { href: '#familie' }, 'Zur Familie')));
}

// ---------- Fotos ----------
export function viewPhotos() {
  const sv = store.config.services;
  const st = h('p.status', null, 'Wird geprüft …');
  (async () => {
    for (const [label, url] of [['Zuhause', sv.immichHome], ['Mobil', sv.immichMobile]]) {
      if (!url) continue;
      try { const r = await http(normalizeBase(url) + 'api/server/ping', { timeout: 3000 }); if (r.data?.res === 'pong') return status(st, `● Immich erreichbar (${label})`, 'ok'); } catch { /* weiter */ }
    }
    status(st, '○ Immich gerade nicht erreichbar – im Heimnetz oder per Tailscale verbinden', 'warn');
  })();
  return h('div.page', null,
    back('Fotos'),
    h('div.card.photo-card', null,
      h('div.big-ic', null, icon('photo', 40)),
      h('h2', null, 'Familienfotos mit Immich'), st,
      h('div.btn-col', null,
        h('button.btn.primary', { onclick: () => openApp('app.alextran.immich', normalizeBase(sv.immichHome)) }, 'Immich-App öffnen'),
        h('button.btn.tonal', { onclick: () => openUrl(normalizeBase(sv.immichHome)) }, icon('external', 18), 'Im Browser (Zuhause)'),
        sv.immichMobile ? h('button.btn.tonal', { onclick: () => openUrl(normalizeBase(sv.immichMobile)) }, icon('external', 18), 'Im Browser (Mobil · Tailscale)') : null)),
    h('p.hint', null, 'Tipp: In der Immich-App „Sicherung“ aktivieren, dann landen neue Handyfotos automatisch auf dem Pi.'));
}

// ---------- Pi & Dienste ----------
export function viewPi() {
  const sv = store.config.services; const s = store.config.server;
  const page = h('div.page');
  const card = (ic, title, statusEl, ...actions) => h('div.card.svc', null, h('div.svc-head', null, h('span.mi', null, icon(ic, 20)), h('b', null, title)), statusEl, actions.length ? h('div.btn-row.wrap', null, ...actions) : null);

  const fhStatus = h('p.status', null, '◌ Wird geprüft …');
  const imStatus = h('p.status', null, '◌ Wird geprüft …');
  const casaStatus = h('p.status', null, '◌ Wird geprüft …');
  const ctlStatus = h('p.status', null, sv.controlToken ? '◌ Wird geprüft …' : '○ Nicht gekoppelt');
  const netLabel = h('span.badge.soft', null, 'Netz wird ermittelt …');

  async function check() {
    [fhStatus, imStatus, casaStatus].forEach((e) => status(e, '◌ Wird geprüft …'));
    const [home, mobile] = await Promise.all([store.probe(normalizeBase(s.home), 3000), store.probe(normalizeBase(s.mobile), 4000)]);
    const atHome = home.ok || home.legacy;
    netLabel.textContent = atHome ? '⌂ Zuhause (Heimnetz)' : mobile.ok || mobile.legacy ? '↔ Unterwegs (Tailscale)' : 'Kein Pi erreichbar';
    const fh = atHome ? home : mobile;
    status(fhStatus, fh.ok ? `● Bereit · Version ${fh.version}${fh.setup ? ' · noch nicht eingerichtet' : ''}` : fh.legacy ? '● Alter Server (2.x) läuft – Update empfohlen' : '○ ' + (fh.msg || 'Nicht erreichbar'), fh.ok ? 'ok' : fh.legacy ? 'warn' : 'bad');
    const imUrl = normalizeBase(atHome ? sv.immichHome : sv.immichMobile);
    try { const r = await http(imUrl + 'api/server/ping', { timeout: 3500 }); status(imStatus, r.data?.res === 'pong' ? '● Bereit' : `○ Unerwartete Antwort (HTTP ${r.status})`, r.data?.res === 'pong' ? 'ok' : 'warn'); } catch (e) { status(imStatus, '○ ' + e.message, 'bad'); }
    const casaUrl = atHome ? sv.casaHome : sv.casaMobile;
    try { const r = await http(casaUrl, { timeout: 3500 }); status(casaStatus, r.status === 200 ? '● Weboberfläche erreichbar' : r.status === 401 || r.status === 403 ? '● Erreichbar · Anmeldung nötig' : `● HTTP ${r.status}`, r.status < 500 ? 'ok' : 'warn'); } catch (e) { status(casaStatus, '○ ' + e.message, 'bad'); }
    page._atHome = atHome;
    if (sv.controlToken) ctlRefresh();
  }

  const ctlBase = () => normalizeBase(page._atHome === false && sv.controlMobile ? sv.controlMobile : sv.controlHome);
  async function ctl(path, body) {
    const r = await http(ctlBase() + path, { method: body ? 'POST' : 'GET', body, headers: { Accept: 'application/json', ...(sv.controlToken ? { Authorization: 'Bearer ' + sv.controlToken } : {}), ...(body ? { 'X-FamilyHub-Control': '1' } : {}) }, timeout: 10000 });
    if (r.status >= 400) throw new Error(r.data?.error || 'Verwaltung meldet HTTP ' + r.status);
    return r.data;
  }
  async function ctlRefresh() {
    try {
      const r = await ctl('api/status');
      const st = r.status || {};
      const svc = st.services || {};
      const op = r.operation;
      let txt = `● Docker ${st.docker ? 'aktiv' : 'gestoppt'} · Fotofestplatte ${st.photo_mount ? 'bereit' : 'fehlt'}\nFamilyHub ${svc.familyhub?.ready ? 'läuft' : 'gestoppt'} · Immich ${svc.immich?.ready ? 'läuft' : 'gestoppt'}`;
      if (op?.state === 'running') { txt += `\n◌ ${op.service}: Aktion läuft …`; setTimeout(ctlRefresh, 4000); }
      if (op?.state === 'failed') txt += `\n● Aktion fehlgeschlagen: ${op.message || ''}`;
      status(ctlStatus, txt, st.docker && st.photo_mount ? 'ok' : 'warn');
    } catch (e) { status(ctlStatus, '○ ' + e.message, 'bad'); }
  }
  async function pair() {
    const code = await promptSheet({ title: 'Pi-Verwaltung koppeln', label: '8-stelliger Code vom Pi', type: 'tel', ok: 'Koppeln', hint: 'Den Code zeigt der Verwaltungsdienst auf dem Pi an.' });
    if (!code) return;
    if (!/^\d{8}$/.test(code.trim())) return toast('Bitte den 8-stelligen Code eingeben');
    try { const r = await ctl('api/pair', { code: code.trim() }); store.saveConfig({ services: { controlToken: r.token } }); toast('Pi gekoppelt'); location.reload(); } catch (e) { toast(e.message); }
  }
  async function action(service, act) {
    if (act !== 'start' && !await confirmSheet({ title: `${service === 'familyhub' ? 'FamilyHub' : 'Immich'} ${act === 'stop' ? 'stoppen' : 'neu starten'}?`, text: 'Laufende Nutzung und Uploads werden kurz unterbrochen.', ok: 'Ausführen', danger: act === 'stop' })) return;
    try { await ctl('api/action', { service, action: act }); status(ctlStatus, '◌ Aktion läuft …'); setTimeout(ctlRefresh, 2500); } catch (e) { toast(e.message); }
  }
  const svcMenu = (service) => h('select.mini', { 'aria-label': 'Aktion', onchange: (e) => { const v = e.target.value; e.target.value = ''; if (v) action(service, v); } }, h('option', { value: '' }, 'Steuern …'), h('option', { value: 'start' }, 'Starten'), h('option', { value: 'restart' }, 'Neu starten'), h('option', { value: 'stop' }, 'Stoppen'));

  page.append(
    back('Pi & Dienste'),
    h('div.net', null, netLabel, h('button.btn.small.tonal', { onclick: check }, icon('sync', 16), 'Prüfen')),
    card('home', 'FamilyHub-Server', fhStatus, sv.controlToken ? svcMenu('familyhub') : null),
    card('photo', 'Immich · Fotos', imStatus, h('button.btn.small.tonal', { onclick: () => go('fotos') }, 'Öffnen'), sv.controlToken ? svcMenu('immich') : null),
    card('grid', 'CasaOS', casaStatus, h('button.btn.small.tonal', { onclick: () => openUrl((page._atHome === false ? sv.casaMobile : sv.casaHome) + '#/') }, icon('external', 16), 'Pi-Oberfläche')),
    card('power', 'Pi-Verwaltung', ctlStatus,
      sv.controlToken ? h('button.btn.small.tonal', { onclick: ctlRefresh }, 'Aktualisieren') : h('button.btn.small.primary', { onclick: pair }, 'Mit Code koppeln'),
      sv.controlToken ? h('button.btn.small.ghost', { onclick: () => { store.saveConfig({ services: { controlToken: null } }); location.reload(); } }, 'Entkoppeln') : null),
    h('div.menu', null,
      row('wifi', 'Tailscale öffnen', 'Für den Zugriff von unterwegs', () => openApp('com.tailscale.ipn', 'https://tailscale.com/download')),
      row('link', 'Adressen bearbeiten', 'FamilyHub, Immich, CasaOS, Verwaltung', editAddresses)));
  setTimeout(check, 50);
  return page;
}

function editAddresses() {
  const s = store.config.server; const sv = store.config.services;
  const f = {};
  const inp = (k, v, ph) => (f[k] = h('input', { value: v || '', placeholder: ph, inputmode: 'url', autocomplete: 'off' }));
  sheet((sh) => h('form.sheet-body', { onsubmit: (e) => {
    e.preventDefault();
    store.saveConfig({
      server: { home: normalizeBase(f.home.value), mobile: normalizeBase(f.mobile.value), active: null },
      services: { immichHome: normalizeBase(f.imH.value), immichMobile: normalizeBase(f.imM.value), casaHome: normalizeBase(f.caH.value), casaMobile: normalizeBase(f.caM.value), controlHome: normalizeBase(f.ctH.value), controlMobile: normalizeBase(f.ctM.value) },
    });
    sh.close(); toast('Adressen gespeichert'); location.reload();
  } },
  h('h2.sheet-title', null, 'Adressen'),
  h('p.hint', null, 'Zuhause = Heimnetz, Mobil = per Tailscale. Die App wählt automatisch die erreichbare Adresse.'),
  h('h3.section-title', null, 'FamilyHub'), h('label.field', null, h('span', null, 'Zuhause'), inp('home', s.home, 'https://192.168.178.51:8443/')), h('label.field', null, h('span', null, 'Mobil'), inp('mobile', s.mobile, 'https://pi.tailnet.ts.net:8443/')),
  h('h3.section-title', null, 'Immich'), h('label.field', null, h('span', null, 'Zuhause'), inp('imH', sv.immichHome)), h('label.field', null, h('span', null, 'Mobil'), inp('imM', sv.immichMobile)),
  h('h3.section-title', null, 'CasaOS'), h('label.field', null, h('span', null, 'Zuhause'), inp('caH', sv.casaHome)), h('label.field', null, h('span', null, 'Mobil'), inp('caM', sv.casaMobile)),
  h('h3.section-title', null, 'Pi-Verwaltung'), h('label.field', null, h('span', null, 'Zuhause'), inp('ctH', sv.controlHome)), h('label.field', null, h('span', null, 'Mobil'), inp('ctM', sv.controlMobile, 'optional')),
  h('div.btn-row', null, h('button.btn.ghost', { type: 'button', onclick: () => sh.close() }, 'Abbrechen'), h('button.btn.primary', { type: 'submit' }, 'Speichern'))), { tall: true, label: 'Adressen' });
}

// ---------- Synchronisierung ----------
export function viewSync() {
  const s = store.config.server;
  const page = h('div.page', null, back('Synchronisierung'));
  if (!store.serverEnabled()) {
    let base, pw, fam;
    const st = h('p.status');
    const form = h('form.card', { onsubmit: async (e) => {
      e.preventDefault();
      status(st, '◌ Verbinde …');
      try {
        const probe = await store.probe(normalizeBase(base.value), 5000);
        if (!probe.ok) throw new Error(probe.msg);
        await store.connect({ base: base.value, password: pw.value, setup: probe.setup, familyName: fam.value || undefined, device: (info().device || 'Handy') });
        store.saveConfig({ server: { home: normalizeBase(base.value) } });
        toast('Verbunden – alle Geräte sind jetzt auf dem gleichen Stand'); location.hash = 'mehr';
      } catch (err) { status(st, '○ ' + err.message, 'bad'); }
    } },
    h('h2', null, 'Mit dem FamilyHub-Server verbinden'),
    h('p.muted', null, 'Damit alle Familienmitglieder dieselben Termine, Aufgaben und Einkäufe sehen. Ohne Server bleibt alles nur auf diesem Handy.'),
    h('label.field', null, h('span', null, 'Server-Adresse'), base = h('input', { value: s.home, inputmode: 'url', autocomplete: 'off', required: true })),
    h('label.field', null, h('span', null, 'Familien-Passwort'), pw = h('input', { type: 'password', required: true, autocomplete: 'current-password' })),
    h('details', null, h('summary', null, 'Server ist neu?'), h('p.hint', null, 'Beim allerersten Verbinden wird das eingegebene Passwort als Familien-Passwort festgelegt.'), h('label.field', null, h('span', null, 'Familienname'), fam = h('input', { placeholder: 'z. B. Familie Müller' }))),
    st,
    h('button.btn.primary.big', { type: 'submit' }, icon('link', 18), 'Verbinden'));
    page.append(form, h('p.hint', null, 'Die Server-Software liegt im Projektordner „familyhub/server“ und läuft per Docker auf dem Pi.'));
    return page;
  }
  const st = h('p.status ' + (store.sync.state === 'error' ? 'bad' : 'ok'), null, store.sync.state === 'error' ? '○ ' + store.sync.error : store.sync.state === 'syncing' ? '◌ Synchronisiere …' : `● Verbunden mit ${s.active || s.home}`);
  const last = s.lastSync ? new Date(s.lastSync).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–';
  page.append(
    h('div.card', null, st, h('p.muted', null, `Zuletzt abgeglichen: ${last}${store.outbox.length ? ` · ${store.outbox.length} Änderung(en) warten` : ''}`),
      h('div.btn-row.wrap', null, h('button.btn.tonal', { onclick: () => store.syncNow().then(() => location.hash = 'sync') }, icon('sync', 18), 'Jetzt abgleichen'))),
    h('div.menu', null,
      row('wifi', 'Verbindung', { auto: 'Automatisch (Zuhause ↔ Mobil)', home: 'Nur Zuhause', mobile: 'Nur Mobil' }[s.mode] || 'Automatisch', async () => {
        const v = await new Promise((res) => sheet((sh) => h('div.sheet-body', null, h('h2.sheet-title', null, 'Verbindung'), ...[['auto', 'Automatisch'], ['home', 'Nur Zuhause (Heimnetz)'], ['mobile', 'Nur Mobil (Tailscale)']].map(([k, l]) => h('button.menu-row', { onclick: () => sh.close(k) }, h('span.mt', null, h('b', null, l)), s.mode === k ? icon('check') : null))), { onClose: res }));
        if (v) { store.saveConfig({ server: { mode: v, active: null } }); store.syncNow(); location.hash = 'sync'; }
      }),
      row('calendar', 'Kalender abonnieren', 'In Google-, Apple- oder Outlook-Kalender anzeigen', async () => {
        try {
          const r = await store.request('api/v2/calendar-link');
          const url = normalizeBase(s.active || s.home) + r.path.replace(/^\//, '');
          sheet((sh) => h('div.sheet-body', null, h('h2.sheet-title', null, 'Kalender-Abo'), h('p.muted', null, 'Diese Adresse in einer Kalender-App als „Kalender per URL abonnieren“ hinzufügen. Wer den Link hat, kann die Termine lesen – nicht weitergeben.'), h('code.url', null, url), h('div.btn-row', null, h('button.btn.tonal', { onclick: () => { copy(url); toast('Kopiert'); } }, 'Kopieren'), h('button.btn.primary', { onclick: () => openUrl(url.replace(/^https?/, 'webcal')) }, 'Öffnen'))));
        } catch (e) { toast(e.message); }
      }),
      row('lock', 'Familien-Passwort ändern', 'Meldet alle Geräte ab', async () => {
        const old = await promptSheet({ title: 'Passwort ändern', label: 'Aktuelles Passwort', type: 'password' }); if (!old) return;
        const nw = await promptSheet({ title: 'Passwort ändern', label: 'Neues Passwort (mind. 6 Zeichen)', type: 'password' }); if (!nw) return;
        try { await store.request('api/v2/password', { method: 'POST', body: { old, password: nw } }); toast('Geändert – bitte neu anmelden'); store.disconnect(); location.hash = 'sync'; } catch (e) { toast(e.message); }
      }),
      row('cloudOff', 'Verbindung trennen', 'Daten bleiben auf diesem Gerät', async () => { if (await confirmSheet({ title: 'Vom Server trennen?', ok: 'Trennen', danger: true })) { store.disconnect(); location.hash = 'sync'; } })));
  return page;
}

// ---------- Einstellungen ----------
export function viewSettings() {
  const c = store.config;
  const sw = (label, sub, key) => h('label.menu-row.switch-row', null, h('span.mt', null, h('b', null, label), sub ? h('small', null, sub) : null), h('span.switch', null, h('input', { type: 'checkbox', checked: !!c[key], onchange: (e) => store.saveConfig({ [key]: e.target.checked }) }), h('span.track')));
  const sel = (label, key, opts) => h('label.menu-row', null, h('span.mt', null, h('b', null, label)), h('select.mini', { onchange: (e) => store.saveConfig({ [key]: isNaN(+e.target.value) ? e.target.value : +e.target.value }) }, ...opts.map(([v, l]) => h('option', { value: v, selected: String(c[key]) === String(v) }, l))));
  return h('div.page', null,
    back('Einstellungen'),
    h('h3.section-title', null, 'Darstellung'),
    h('div.menu', null, sel('Design', 'theme', [['system', 'Wie System'], ['light', 'Hell'], ['dark', 'Dunkel']])),
    h('h3.section-title', null, 'Sprachsteuerung'),
    h('div.menu', null,
      sw('Direkt speichern', 'Nach dem Sprechen ohne Nachfrage eintragen (Rückgängig bleibt möglich)', 'voiceAutoSave'),
      sw('Bestätigung vorlesen', 'FamilyHub sagt kurz, was eingetragen wurde', 'voiceSpeak')),
    h('h3.section-title', null, 'Erinnerungen'),
    h('div.menu', null,
      sel('Standard bei Terminen', 'remindDefault', [['', 'Keine'], [0, 'Zur Startzeit'], [10, '10 Min. vorher'], [30, '30 Min. vorher'], [60, '1 Std. vorher']]),
      isApp ? row('bell', 'Benachrichtigungen erlauben', null, () => requestNotifications()) : null),
    h('h3.section-title', null, 'Wandansicht & Bilderrahmen'),
    h('div.menu', null,
      sel('Automatisch starten nach', 'wallIdleMin', [[0, 'Nie'], [2, '2 Min. ohne Bedienung'], [5, '5 Min.'], [10, '10 Min.'], [30, '30 Min.']]),
      sel('Fotowechsel', 'wallSlideSec', [[10, 'alle 10 s'], [20, 'alle 20 s'], [60, 'jede Minute'], [300, 'alle 5 Min.']]),
      row('photo', 'Jetzt starten', 'Fotos kommen aus Immich (über den Pi)', () => openWall())),
    h('h3.section-title', null, 'Daten'),
    h('div.menu', null,
      row('download', 'Sicherung exportieren', 'Alle Einträge als Datei', () => { saveFile(`familyhub-${new Date().toISOString().slice(0, 10)}.json`, store.exportJson()); }),
      row('upload', 'Sicherung importieren', 'Einträge aus Datei übernehmen', async () => { const t = await pickFile(); if (!t) return; try { toast(`${store.importJson(t)} Einträge importiert`); } catch { toast('Datei konnte nicht gelesen werden'); } }),
      row('trash', 'Alles auf diesem Gerät löschen', null, async () => { if (await confirmSheet({ title: 'Wirklich alles löschen?', text: 'Termine, Aufgaben, Einkauf und Familie auf diesem Gerät werden entfernt. Auf dem Server bleibt alles erhalten.', ok: 'Löschen', danger: true })) { localStorage.clear(); location.reload(); } })),
    h('p.footnote', null, `FamilyHub ${APP_VERSION}${info().version ? ' · App ' + info().version : ''}`));
}

// ---------- Hilfe ----------
export function viewHelp() {
  const ex = [
    ['Termine', ['Morgen um 15 Uhr Zahnarzt mit Lena', 'Elternabend am 3.12. um halb acht abends', 'Fußball jeden Dienstag von 17 bis 18:30 Uhr für Ben', 'Oma Geburtstag am 14. März', 'Arzt am Montag um 8, erinnere mich eine Stunde vorher']],
    ['Aufgaben', ['Papa muss morgen den Müll rausbringen', 'Erinnere mich Freitag an die Brotdosen', 'Pflanzen gießen alle 3 Tage', 'Neue Aufgabe: Steuererklärung abgeben, wichtig']],
    ['Fragen', ['Was steht heute an?', 'Was hat Lena morgen?', 'Wann ist der Elternabend?', 'Was gibt es heute zu essen?', 'Was steht auf der Einkaufsliste?', 'Wie viele Sterne hat Ben?', 'Was muss Ben heute noch machen?']],
    ['Erledigt melden', ['Lena hat den Tisch gedeckt', 'Ben hat den Müll rausgebracht', 'Steuererklärung ist erledigt', 'Milch ist gekauft']],
    ['Essensplan', ['Am Freitag gibt es Pizza zum Abendessen', 'Morgen essen wir Spaghetti zum Mittag']],
    ['Einkauf', ['Milch, Eier und Brot auf die Einkaufsliste', 'Wir brauchen noch Waschmittel', 'Kaufe zwei Gurken und Tomaten']],
  ];
  return h('div.page', null,
    back('Sprachbefehle'),
    h('p.muted', null, 'Sprich ganz normal. FamilyHub erkennt Datum, Uhrzeit, Personen, Wiederholungen und ob es ein Termin, eine Aufgabe oder ein Einkauf ist. Antippen zum Ausprobieren:'),
    ...ex.map(([title, list]) => h('section.section', null, h('h3.section-title', null, title), h('div.menu', null, ...list.map((t) => h('button.menu-row', { onclick: () => openCapture({ mode: 'text', text: t }) }, h('span.mt', null, h('b', null, '„' + t + '“')), icon('right', 18)))))),
    h('div.card', null, h('b', null, 'Gut zu wissen'), h('ul.tips', null,
      h('li', null, 'Wörter wie „heute, morgen, übermorgen, nächsten Freitag, in 2 Wochen, am 24.12.“ werden verstanden.'),
      h('li', null, 'Uhrzeiten: „um 8“, „15:30“, „halb vier“, „viertel nach zehn“, „von 14 bis 16 Uhr“. „Um 3“ bedeutet 15 Uhr.'),
      h('li', null, 'Unter „Familie“ kannst du Spitznamen hinterlegen, z. B. „Mama“ oder „Schatz“.'),
      h('li', null, 'Auf dem Startbildschirm: Widget „FamilyHub“ mit Mikrofon-Taste, oder App-Symbol lange drücken → „Sprechen“.'))));
}

// ---------- Externe Kalender ----------
const PROVIDERS = [
  ['Google Kalender', 'Google Kalender im Browser → Einstellungen → Kalender auswählen → „Privatadresse im iCal-Format“ kopieren.'],
  ['Apple iCloud', 'iPhone: Kalender-App → Kalender → (i) → „Öffentlicher Kalender“ an → Link teilen/kopieren. Beginnt mit webcal://'],
  ['Outlook / Microsoft 365', 'outlook.com → Einstellungen → Kalender → Freigegebene Kalender → „Kalender veröffentlichen“ → ICS-Link kopieren.'],
  ['Schule, Ferien, Müllabfuhr', 'Viele Schulen, Vereine und Gemeinden bieten einen iCal-/ICS-Link an. Ferien z. B. von schulferien.org.'],
];

export function viewExternal() {
  const list = calendars();
  return h('div.page', null,
    back('Kalender verbinden'),
    h('p.muted', null, 'Termine aus Google, Apple, Outlook oder Schul-/Ferienkalendern erscheinen automatisch in FamilyHub – farbig markiert und alle 30 Minuten aktualisiert. Ändern geht weiterhin im Original-Kalender.'),
    list.length ? h('div.menu', null, ...list.map((c) => {
      const st = calStatus(c.id);
      const sub = st?.error ? '⚠ ' + st.error : st?.fetched ? `${st.count} Termine · aktualisiert ${new Date(st.fetched).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'Wird geladen …';
      return h('button.menu-row', { onclick: () => editCalendar(c) }, h('span.mi', { style: { background: c.color, color: '#fff' } }, icon('calendar', 20)), h('span.mt', null, h('b', null, c.name), h('small', null, sub)), icon('right', 18));
    })) : null,
    h('button.btn.primary.big.more-btn', { onclick: () => editCalendar(null) }, icon('plus', 18), 'Kalender hinzufügen'),
    h('h3.section-title', null, 'Wo finde ich die iCal-Adresse?'),
    h('div.menu', null, ...PROVIDERS.map(([t, d]) => h('details.menu-row.howto', null, h('summary', null, t), h('p.muted', null, d)))));
}

function editCalendar(c) {
  const used = new Set(calendars().map((x) => x.color));
  const v = { name: '', url: '', color: MEMBER_COLORS.find((x) => !used.has(x)) || MEMBER_COLORS[1], memberIds: [], enabled: true, ...(c || {}) };
  const f = {};
  let color = v.color;
  const sw = h('div.swatches');
  const draw = () => sw.replaceChildren(...MEMBER_COLORS.map((x) => h('button.swatch' + (x === color ? '.on' : ''), { type: 'button', style: { background: x }, 'aria-label': 'Farbe', onclick: () => { color = x; draw(); } })));
  draw();
  const set = new Set(v.memberIds);
  const ppl = h('div.chips.people');
  const drawP = () => ppl.replaceChildren(...members().map((m) => h('button.person' + (set.has(m.id) ? '.on' : ''), { type: 'button', style: { '--c': m.color }, onclick: () => { set.has(m.id) ? set.delete(m.id) : set.add(m.id); drawP(); } }, h('span.av', null, m.emoji || m.name[0]), m.name)));
  drawP();
  const st = h('p.status');
  sheet((s) => h('form.sheet-body', { onsubmit: async (e) => {
    e.preventDefault();
    const url = f.url.value.trim().replace(/^webcal:\/\//i, 'https://');
    if (!/^https?:\/\//i.test(url)) return status(st, 'Bitte eine iCal-Adresse (https://… oder webcal://…) einfügen', 'bad');
    const saved = store.put('calendars', { ...(c || {}), name: f.name.value.trim() || 'Kalender', url, color, memberIds: [...set], enabled: f.on.checked });
    status(st, '◌ Wird geladen …');
    const r = await refreshCalendar(saved);
    if (r.error) return status(st, '○ ' + r.error + ' – gespeichert, wird später erneut versucht.', 'bad');
    s.close(); toast(`${r.count} Termine aus „${saved.name}“`); location.hash = 'extern';
  } },
  h('h2.sheet-title', null, c ? c.name : 'Kalender verbinden'),
  h('label.field', null, h('span', null, 'Name'), f.name = h('input', { value: v.name, placeholder: 'z. B. Papas Arbeit, Schulferien', required: true, autofocus: !c })),
  h('label.field', null, h('span', null, 'iCal-Adresse'), f.url = h('textarea', { rows: 3, value: v.url, placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics' })),
  h('label.field', null, h('span', null, 'Farbe'), sw),
  members().length ? h('label.field', null, h('span', null, 'Gehört zu (für Filter & Wandansicht)'), ppl) : null,
  h('label.switch', null, f.on = h('input', { type: 'checkbox', checked: v.enabled !== false }), h('span.track'), h('span', null, 'Anzeigen')),
  st,
  h('div.btn-row', null,
    c ? h('button.btn.danger-ghost', { type: 'button', onclick: async () => { if (await confirmSheet({ title: `„${c.name}“ entfernen?`, text: 'Die Termine verschwinden aus FamilyHub, im Original bleiben sie.', ok: 'Entfernen', danger: true })) { store.del('calendars', c.id); s.close(); location.hash = 'extern'; } } }, icon('trash', 18), 'Entfernen') : h('span'),
    h('button.btn.primary', { type: 'submit' }, c ? 'Speichern' : 'Verbinden'))), { tall: true, label: 'Kalender' });
}
