// Anmeldung im „Liquid Glass“-Stil: Glas-Logo, Felder mit Symbolen, Angemeldet bleiben, Passwort vergessen,
// Pi automatisch suchen, ohne Pi nutzen. Danach: „Wer nutzt dieses Gerät?“.
import { h, icon, toast, sheet } from './ui.js';
import { store, normalizeBase, webOrigin } from './store.js';
import { info, copy, isApp } from './native.js';
import { members } from './domain.js';

let open = null;

/** Logo: Haus mit Herz aus Glas-Schichten */
export function logoMark(size = 84) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<defs>
    <linearGradient id="lgA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8FB0FF"/><stop offset=".55" stop-color="#3563F0"/><stop offset="1" stop-color="#1D3BC4"/></linearGradient>
    <linearGradient id="lgB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C9D6FF"/></linearGradient>
    <linearGradient id="lgC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B9A8FF"/><stop offset="1" stop-color="#6C5CE7"/></linearGradient></defs>
    <path d="M30 9.5a3.2 3.2 0 0 1 4 0l20 16.6a3 3 0 0 1-1.9 5.3H49V51a5 5 0 0 1-5 5H20a5 5 0 0 1-5-5V31.4h-3.1a3 3 0 0 1-1.9-5.3z" fill="url(#lgA)"/>
    <path d="M17 31.4 32 19l15 12.4" fill="none" stroke="url(#lgC)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>
    <path d="M32 49.5c-8.4-5.6-10.6-9.6-10.6-13a5.6 5.6 0 0 1 10.6-2.5 5.6 5.6 0 0 1 10.6 2.5c0 3.4-2.2 7.4-10.6 13z" fill="url(#lgB)"/>
    <ellipse cx="24" cy="24" rx="7" ry="3.2" fill="#fff" opacity=".28" transform="rotate(-38 24 24)"/>`;
  return s;
}

/** Muss angemeldet werden? (abgemeldet oder erster Start) */
export function needsLogin() {
  const s = store.config.server;
  if (s.mode !== 'off' && !s.token) return true; // abgemeldet (z. B. Passwort geändert)
  if (webOrigin && !s.token && !store.config.localOnly) return true; // Seite kommt vom Pi (iPad/iPhone)
  return !store.config.onboarded && !s.token && !store.config.localOnly && !members().length && !store.list('events').length;
}

export function showLogin({ onDone } = {}) {
  if (open) return open;
  const s = store.config.server;
  let setup = false;
  const field = (ic, input, extra) => h('label.lg-field', null, h('span.lg-ic', null, icon(ic, 22)), input, extra || null);
  const addr = h('input', { value: webOrigin || s.home || s.active || '', placeholder: 'Adresse des Pi, z. B. 192.168.178.51:8446', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Adresse des Pi' });
  const pw = h('input', { type: 'password', placeholder: 'Familien-Passwort', autocomplete: 'current-password', 'aria-label': 'Familien-Passwort' });
  const fam = h('input', { placeholder: 'Familienname (optional)', 'aria-label': 'Familienname' });
  const eye = h('button.lg-eye', { type: 'button', 'aria-label': 'Passwort anzeigen', onclick: () => { const show = pw.type === 'password'; pw.type = show ? 'text' : 'password'; eye.replaceChildren(icon(show ? 'eye' : 'eye-off', 22)); } }, icon('eye-off', 22));
  const remember = h('input', { type: 'checkbox', checked: true });
  const msg = h('p.lg-msg', { role: 'status' });
  const famField = field('users', fam); famField.hidden = true;
  const title = h('h1.lg-title', null, 'Willkommen zurück');
  const sub = h('p.lg-sub', null, 'Melde dich bei eurer Familie an');
  const btnLabel = h('span', null, 'Anmelden');
  const submit = h('button.lg-submit', { type: 'submit' }, btnLabel, h('span.lg-arrow', null, icon('arrow-right', 22)));

  const say = (t, kind) => { msg.textContent = t || ''; msg.className = 'lg-msg' + (kind ? ' ' + kind : ''); };
  async function check() {
    const b = normalizeBase(webOrigin || addr.value);
    if (!b) return null;
    const p = await store.probe(b, 4000);
    setup = !!p.setup;
    famField.hidden = !setup;
    title.textContent = setup ? 'Willkommen!' : 'Willkommen zurück';
    sub.textContent = setup ? 'Lege euer Familien-Passwort fest' : 'Melde dich bei eurer Familie an';
    btnLabel.textContent = setup ? 'Einrichten' : 'Anmelden';
    pw.placeholder = setup ? 'Passwort festlegen (mind. 6)' : 'Familien-Passwort';
    return p;
  }
  addr.addEventListener('change', () => check().then((p) => p && say(p.ok ? '' : p.msg, p.ok ? '' : 'bad')));

  const form = h('form.lg-form', { onsubmit: async (e) => {
    e.preventDefault();
    if (!pw.value) { pw.focus(); return; }
    submit.disabled = true; say('Verbinde …');
    try {
      const p = await check();
      if (!p || !p.ok) throw new Error(p?.msg || 'Bitte die Adresse des Pi eintragen.');
      await store.connect({ base: webOrigin || addr.value, password: pw.value, setup, familyName: fam.value || undefined, device: info().device || (isApp ? 'Handy' : navigator.platform || 'Browser') });
      store.saveConfig({ onboarded: true, localOnly: false, server: { home: normalizeBase(webOrigin || addr.value), ephemeral: !remember.checked } });
      say('');
      whoStep();
    } catch (err) { say(err.message, 'bad'); root.querySelector('.lg-card').animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 300 }); }
    finally { submit.disabled = false; }
  } },
  webOrigin ? null : field('server', addr),
  field('lock', pw, eye),
  famField,
  h('div.lg-row', null,
    h('label.lg-check', null, remember, h('span.lg-box', null, icon('check', 16)), 'Angemeldet bleiben'),
    h('button.lg-link', { type: 'button', onclick: forgot }, 'Passwort vergessen?')),
  msg,
  submit);

  const alt = (ic, label, onclick, hidden) => (hidden ? null : h('button.lg-alt', { type: 'button', onclick, 'aria-label': label }, h('span.lg-alt-ic', null, icon(ic, 26)), h('small', null, label)));
  const card = h('div.lg-card', null,
    h('div.lg-logo', null, logoMark(84)),
    title, sub, form,
    h('div.lg-or', null, h('span', null, 'oder weiter mit')),
    h('div.lg-alts', null,
      alt('search', 'Pi suchen', search, !!webOrigin),
      alt('smartphone', 'Nur dieses Gerät', () => { store.saveConfig({ onboarded: true, localOnly: true }); close(); toast('Alles bleibt auf diesem Gerät – verbinden geht später unter Mehr → Synchronisierung'); }),
      alt('circle-help', 'Hilfe', help)),
    h('p.lg-tag', null, 'Planen', h('i'), 'Erledigen', h('i'), 'Gemeinsam wachsen'));

  const theme = h('button.lg-theme', { type: 'button', 'aria-label': 'Hell oder dunkel', onclick: () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    store.saveConfig({ theme: dark ? 'light' : 'dark' }); document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    syncDark();
  } }, icon('moon', 22));
  const root = h('div.login', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Anmelden' },
    h('span.lg-blob.b1'), h('span.lg-blob.b2'), h('span.lg-blob.b3'), h('span.lg-blob.b4'),
    theme, card, h('p.lg-corner', null, 'Mehr', h('br'), 'als ein', h('br'), 'Kalender'));
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark' || (document.documentElement.getAttribute('data-theme') !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const syncDark = () => { root.classList.toggle('dark', isDark()); theme.replaceChildren(icon(isDark() ? 'sun' : 'moon', 22)); };
  syncDark();
  document.body.append(root);
  document.body.classList.add('login-open');
  setTimeout(() => (webOrigin || addr.value ? pw : addr).focus(), 350);
  check().catch(() => {});

  function close() {
    root.classList.add('leaving'); document.body.classList.remove('login-open');
    setTimeout(() => { root.remove(); open = null; onDone?.(); }, 380);
  }

  // Schritt 2: Wer nutzt dieses Gerät?
  function whoStep() {
    const ms = members();
    if (!ms.length || store.config.meId) { close(); toast('Angemeldet – alle Geräte sind auf dem gleichen Stand'); return; }
    const pick = (id) => { store.saveConfig({ meId: id }); close(); toast(id ? 'Willkommen!' : 'Gemeinsames Gerät eingerichtet'); };
    card.replaceChildren(
      h('div.lg-logo.small', null, logoMark(56)),
      h('h1.lg-title', null, 'Wer bist du?'),
      h('p.lg-sub', null, 'Dann kommen Erinnerungen nur für dich'),
      h('div.lg-who', null, ...ms.map((m) => h('button.lg-person', { type: 'button', style: { '--c': m.color }, onclick: () => pick(m.id) }, h('span.av', { style: { '--c': m.color } }, (m.name || '?')[0].toUpperCase()), h('b', null, m.name)))),
      h('button.lg-submit.ghosty', { type: 'button', onclick: () => pick(null) }, h('span', null, 'Gemeinsames Gerät (z. B. Tablet)'), h('span.lg-arrow', null, icon('arrow-right', 22))));
  }

  function forgot() {
    sheet((sh) => h('div.sheet-body', null, h('h2.sheet-title', null, 'Passwort vergessen?'),
      h('p.muted', null, 'Das Familien-Passwort lässt sich auf dem Pi neu setzen. Im Terminal des Pi eingeben:'),
      h('code.url', null, 'cd ~/Ableton-Studio-Toolz/familyhub && ./install-pi.sh passwort'),
      h('p.hint', null, 'Geräte, die schon angemeldet sind, bleiben angemeldet. Oder frag jemanden aus der Familie, dessen Handy schon verbunden ist: Mehr → Synchronisierung → „Familien-Passwort ändern“.'),
      h('div.btn-row', null, h('button.btn.ghost', { onclick: () => sh.close() }, 'Schließen'), h('button.btn.primary', { onclick: () => { copy('cd ~/Ableton-Studio-Toolz/familyhub && ./install-pi.sh passwort'); toast('Befehl kopiert'); } }, icon('copy', 18), 'Befehl kopieren'))), { label: 'Passwort vergessen' });
  }
  function help() {
    sheet((sh) => h('div.sheet-body', null, h('h2.sheet-title', null, 'So klappt die Anmeldung'),
      h('ol.tips', null,
        h('li', null, 'Der Pi zeigt seine Adresse am Ende der Installation an, z. B. 192.168.178.51:8446 (Befehl auf dem Pi: ./install-pi.sh status).'),
        h('li', null, 'Das Gerät muss im selben WLAN sein – nicht im Gast-WLAN.'),
        h('li', null, 'Beim allerersten Verbinden legt ihr das Familien-Passwort fest; alle weiteren Geräte melden sich damit an.'),
        h('li', null, 'Lädt nichts? In der FRITZ!Box unter WLAN → Sicherheit „WLAN-Geräte dürfen untereinander kommunizieren“ anhaken.')),
      h('div.btn-row', null, h('span'), h('button.btn.primary', { onclick: () => sh.close() }, 'Verstanden'))), { label: 'Hilfe' });
  }
  async function search() {
    say('Suche den Pi im Heimnetz …');
    const tried = new Set();
    const probe = async (b) => { b = normalizeBase(b); if (!b || tried.has(b)) return null; tried.add(b); try { const p = await store.probe(b, 1500); return p.ok || p.setup ? b : null; } catch { return null; } };
    const known = [addr.value, s.home, s.active, 'http://familyhub.local:8446', 'http://raspberrypi.local:8446', 'http://autodartspi.local:8446'].filter(Boolean);
    for (const k of known) { const hit = await probe(k); if (hit) return found(hit); }
    // FRITZ!Box-Standardnetz durchsuchen (in Paketen)
    const ips = [...Array(254)].map((_, i) => `http://192.168.178.${i + 1}:8446`);
    for (let i = 0; i < ips.length; i += 32) {
      say(`Suche den Pi im Heimnetz … ${Math.round((i / ips.length) * 100)} %`);
      const hits = (await Promise.all(ips.slice(i, i + 32).map(probe))).filter(Boolean);
      if (hits.length) return found(hits[0]);
    }
    say('Kein Pi gefunden. Adresse bitte eintippen (Befehl auf dem Pi: ./install-pi.sh status).', 'bad');
  }
  function found(b) { addr.value = b.replace(/\/$/, ''); say('Pi gefunden: ' + addr.value, 'ok'); check(); pw.focus(); }

  open = { close };
  return open;
}
