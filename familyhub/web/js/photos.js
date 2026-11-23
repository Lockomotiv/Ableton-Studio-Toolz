// Fotos aus Immich: Galerie, Vollbild-Ansicht, Immich-Verbindung und Einstellungen der Diashow.
import { h, icon, toast, sheet, fmt } from './ui.js';
import { store, normalizeBase } from './store.js';
import { openUrl, openApp, viaApp } from './native.js';

export const SLIDE_DEFAULTS = { idleMin: 1, source: 'family', albums: [], interval: 12, effect: 'kenburns', overlay: 'agenda', captions: true };
export function slideCfg() {
  const c = store.config;
  const legacy = {};
  if (c.wallIdleMin != null && c.slideshow == null) legacy.idleMin = +c.wallIdleMin;
  if (c.wallSlideSec != null && c.slideshow == null) legacy.interval = +c.wallSlideSec;
  const cfg = { ...SLIDE_DEFAULTS, ...legacy, ...(c.slideshow || {}) };
  // Solange auf diesem Gerät niemand bewusst eine Quelle gewählt hat, gilt der Familien-Standard
  if (!cfg.sourceSet && !(cfg.source === 'albums' && cfg.albums.length)) cfg.source = 'family';
  return cfg;
}
export function saveSlide(patch) { store.saveConfig({ slideshow: { ...slideCfg(), ...patch } }); }

export const SOURCES = { family: '👪 Familien-Diashow', random: '🎲 Zufällig aus allen', favorites: '⭐ Favoriten', memories: '📅 An diesem Tag', recent: '🆕 Neueste', albums: '🗂️ Ausgewählte Alben' };
export const EFFECTS = { kenburns: 'Sanfter Zoom (Ken Burns)', fade: 'Überblenden', slide: 'Schieben', zoom: 'Hineinzoomen', mix: 'Abwechselnd' };
export const OVERLAYS = { agenda: 'Uhr + Tagesplan', clock: 'Nur Uhr & Datum', none: 'Nur Fotos' };

/** Fotos laden (über den Pi). Liefert {items, base, key} oder wirft mit verständlicher Meldung. */
export async function loadPhotos({ source, albums, limit = 80 } = {}) {
  if (!store.serverEnabled()) throw new Error('Für Fotos die App mit dem Pi verbinden (Mehr → Synchronisierung).');
  const cfg = slideCfg();
  const src = source || cfg.source;
  const ids = (albums || cfg.albums || []).join(',');
  const r = await store.request(`api/v2/photos?source=${src}&limit=${limit}${src === 'albums' ? '&albums=' + ids : ''}`, { timeout: 30000 });
  const base = await store.resolveBase();
  return { items: r.items || [], base, key: r.key, family: r.family || null, fallback: !!r.fallback };
}
export const photoUrl = (base, key, id, size = 'preview') => viaApp(`${base}api/v2/photos/${encodeURIComponent(id)}?key=${encodeURIComponent(key)}&size=${size}`);

export function caption(p) {
  if (!p?.date) return p?.city || '';
  const d = new Date(p.date);
  const yrs = new Date().getFullYear() - d.getFullYear();
  const when = `${d.getDate()}. ${fmt.MO[d.getMonth()]} ${d.getFullYear()}`;
  return [when + (yrs > 0 ? ` · vor ${yrs} ${yrs === 1 ? 'Jahr' : 'Jahren'}` : ''), p.city].filter(Boolean).join(' · ');
}

// ================= Galerie =================
const gstate = { source: 'family', cache: null };
export function viewPhotos() {
  const page = h('div.page');
  const head = h('div.page-head', null, h('a.icon-btn', { href: '#mehr', 'aria-label': 'Zurück' }, icon('left')), h('h1', null, 'Fotos'),
    h('a.icon-btn', { href: '#diashow', 'aria-label': 'Diashow-Einstellungen' }, icon('settings')));
  page.append(head);
  if (!store.serverEnabled()) {
    page.append(h('div.card.tip', null, h('b', null, 'Familienfotos aus Immich'), h('p', null, 'Verbinde die App zuerst mit eurem Pi. Dann erscheinen hier eure Immich-Fotos – und als Diashow, wenn die App eine Minute nicht bedient wird.'), h('a.btn.primary', { href: '#sync' }, icon('link', 18), 'Mit dem Pi verbinden')), immichButtons());
    return page;
  }
  const body = h('div', null, h('p.soft', null, 'Wird geladen …'));
  page.append(body);
  (async () => {
    let info;
    try { info = await store.request('api/v2/immich'); } catch (e) { body.replaceChildren(h('p.status.bad', null, '○ ' + e.message)); return; }
    if (!info.configured) { body.replaceChildren(connectForm(info), immichButtons()); return; }
    const chips = h('div.filter.tight', null, ...Object.entries(SOURCES).filter(([k]) => k !== 'albums').map(([k, l]) => h('button.fchip' + (gstate.source === k ? '.on' : ''), { onclick: () => { gstate.source = k; gstate.cache = null; page.replaceWith(viewPhotos()); } }, l)),
      h('button.fchip' + (gstate.source.startsWith('album:') ? '.on' : ''), { onclick: () => pickAlbum((id) => { gstate.source = 'album:' + id; gstate.cache = null; page.replaceWith(viewPhotos()); }) }, '🗂️ Album …'));
    const grid = h('div.photo-grid');
    body.replaceChildren(
      h('div.slide-cta', null, h('button.btn.primary', { onclick: async () => { const { openWall } = await import('./wall.js'); openWall({ screensaver: true }); } }, icon('photo', 18), 'Diashow starten'), h('a.btn.tonal', { href: '#diashow' }, icon('settings', 18), 'Einstellungen')),
      chips, grid,
      h('p.hint', null, `Verbunden mit Immich${info.user ? ' (' + info.user + ')' : ''}. `, h('a', { href: '#', onclick: (e) => { e.preventDefault(); body.replaceChildren(connectForm(info)); } }, 'Verbindung ändern')),
      immichButtons());
    try {
      const src = gstate.source.startsWith('album:') ? { source: 'albums', albums: [gstate.source.slice(6)] } : { source: gstate.source };
      const r = gstate.cache || await loadPhotos({ ...src, limit: 120 });
      gstate.cache = r;
      if (r.fallback && gstate.source === 'family') grid.before(h('p.hint', null, 'Kein Album „Familien-Diashow“ in Immich gefunden – hier stehen zufällige Fotos. Album anlegen oder unter ', h('a', { href: '#diashow' }, 'Diashow-Einstellungen'), ' ein anderes wählen.'));
      else if (r.family?.names?.length && gstate.source === 'family') grid.before(h('p.hint', null, `Album ${r.family.names.map((n) => `„${n}“`).join(', ')} · ${r.items.length} Fotos`));
      if (!r.items.length) { grid.replaceWith(h('p.soft', null, gstate.source === 'memories' ? 'An diesem Tag gibt es in früheren Jahren keine Fotos.' : 'Keine Fotos gefunden.')); return; }
      grid.append(...r.items.map((p, i) => h('button.photo', { 'aria-label': caption(p) || 'Foto', style: { backgroundImage: `url("${photoUrl(r.base, r.key, p.id, 'thumbnail')}")` }, onclick: () => viewer(r, i) })));
      // Prüfen, ob die Vorschaubilder wirklich ankommen – sonst verständlich sagen, woran es liegt
      const probe = new Image();
      probe.onerror = async () => {
        let why = 'Die Vorschaubilder kommen nicht an.';
        try { await store.request(`api/v2/photos/${encodeURIComponent(r.items[0].id)}?key=${encodeURIComponent(r.key)}&size=thumbnail`); } catch (e) { if (e.message) why = e.message; }
        grid.before(h('div.card.warn-card', null, h('b', null, 'Fotos werden nicht angezeigt'), h('p', null, why),
          h('p.hint', null, 'Tipp: In Immich unter Kontoeinstellungen → API-Schlüssel braucht der Schlüssel die Rechte „asset.read“, „asset.view“ und „album.read“ (oder „Alle“). Danach hier „Verbindung ändern“ und den neuen Schlüssel eintragen.')));
      };
      probe.src = photoUrl(r.base, r.key, r.items[0].id, 'thumbnail');
    } catch (e) { grid.replaceWith(h('p.status.bad', null, '○ ' + e.message)); }
  })();
  return page;
}

function immichButtons() {
  const sv = store.config.services;
  return h('div.btn-row.wrap', null,
    h('button.btn.small.tonal', { onclick: () => openApp('app.alextran.immich', normalizeBase(sv.immichHome)) }, 'Immich-App öffnen'),
    h('button.btn.small.ghost', { onclick: () => openUrl(normalizeBase(sv.immichHome)) }, icon('external', 16), 'Immich im Browser'));
}

function pickAlbum(cb) {
  sheet((s) => {
    const list = h('div.menu', null, h('p.soft', null, 'Alben werden geladen …'));
    store.request('api/v2/photo-albums').then((r) => list.replaceChildren(...(r.albums.length ? r.albums.map((a) => h('button.menu-row', { onclick: () => { s.close(); cb(a.id); } }, h('span.mi.emoji-mi', null, '🗂️'), h('span.mt', null, h('b', null, a.name), h('small', null, `${a.count} Medien`)), icon('right', 18))) : [h('p.soft', null, 'Keine Alben in Immich.')]))).catch((e) => list.replaceChildren(h('p.status.bad', null, e.message)));
    return h('div.sheet-body', null, h('h2.sheet-title', null, 'Album wählen'), list);
  }, { tall: true, label: 'Album' });
}

/** Vollbild-Ansicht mit Wischen */
function viewer(r, start) {
  let i = start;
  const img = h('div.viewer-img'); const cap = h('div.viewer-cap');
  const show = () => { const p = r.items[i]; img.style.backgroundImage = `url("${photoUrl(r.base, r.key, p.id, 'preview')}")`; cap.textContent = caption(p); };
  const root = h('div.viewer', { role: 'dialog', 'aria-label': 'Foto' }, img, cap,
    h('button.viewer-btn.prev', { 'aria-label': 'Vorheriges', onclick: (e) => { e.stopPropagation(); i = (i - 1 + r.items.length) % r.items.length; show(); } }, icon('left', 30)),
    h('button.viewer-btn.next', { 'aria-label': 'Nächstes', onclick: (e) => { e.stopPropagation(); i = (i + 1) % r.items.length; show(); } }, icon('right', 30)),
    h('button.wall-close', { 'aria-label': 'Schließen', onclick: () => close() }, '×'));
  let x0 = null;
  root.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  root.addEventListener('pointerup', (e) => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) { i = (i + (dx < 0 ? 1 : -1) + r.items.length) % r.items.length; show(); } });
  const close = () => { root.remove(); window.removeEventListener('keydown', key); window.fhViewerClose = null; };
  const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') { i = (i + 1) % r.items.length; show(); } if (e.key === 'ArrowLeft') { i = (i - 1 + r.items.length) % r.items.length; show(); } };
  window.addEventListener('keydown', key);
  window.fhViewerClose = close;
  document.body.append(root); show();
}

/** Immich verbinden – der Schlüssel wird nur auf dem Pi gespeichert */
function connectForm(info = {}) {
  const f = {}; const st = h('p.status');
  const sv = store.config.services;
  return h('form.card', { onsubmit: async (e) => {
    e.preventDefault();
    st.className = 'status'; st.textContent = '◌ Verbindung wird geprüft …';
    try {
      const r = await store.request('api/v2/immich', { method: 'POST', body: { url: f.url.value.trim(), key: f.key.value.trim(), insecure: f.ins.checked }, timeout: 20000 });
      toast(`Immich verbunden${r.user ? ' – ' + r.user : ''} 📷`); gstate.cache = null; location.hash = 'fotos'; window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) { st.className = 'status bad'; st.textContent = '○ ' + err.message; }
  } },
  h('h2', null, 'Immich verbinden'),
  h('p.muted', null, 'FamilyHub zeigt eure Immich-Fotos in der Galerie und als Diashow. Der API-Schlüssel bleibt auf dem Pi und wird nie auf die Handys übertragen.'),
  h('label.field', null, h('span', null, 'Immich-Adresse (vom Pi aus gesehen)'), f.url = h('input', { value: info.url || 'http://host.docker.internal:2283', inputmode: 'url', autocomplete: 'off', required: true })),
  h('p.hint', null, `Läuft Immich auf demselben Pi: http://host.docker.internal:2283 – sonst z. B. ${normalizeBase(sv.immichHome)}`),
  h('label.field', null, h('span', null, 'API-Schlüssel'), f.key = h('input', { type: 'password', autocomplete: 'off', placeholder: info.configured ? '(unverändert lassen)' : 'aus Immich kopieren', required: !info.configured })),
  h('details', null, h('summary', null, 'Wo finde ich den API-Schlüssel?'), h('ol.tips', null,
    h('li', null, 'Immich im Browser öffnen und anmelden'), h('li', null, 'Oben rechts auf das Profilbild → „Kontoeinstellungen“'),
    h('li', null, '„API-Schlüssel“ → „Neuer API-Schlüssel“, Name z. B. „FamilyHub“'), h('li', null, 'Rechte: asset.read, asset.view, album.read (oder alle)'), h('li', null, 'Schlüssel kopieren und hier einfügen'))),
  h('label.switch', null, f.ins = h('input', { type: 'checkbox', checked: !!info.insecure }), h('span.track'), h('span', null, 'Selbstsigniertes Zertifikat erlauben')),
  st,
  h('button.btn.primary.big', { type: 'submit' }, icon('link', 18), 'Verbinden & testen'),
  info.configured && !info.fromEnv ? h('button.btn.ghost', { type: 'button', onclick: async () => { await store.request('api/v2/immich', { method: 'POST', body: { disconnect: true } }); location.reload(); } }, 'Verbindung trennen') : null);
}

// ================= Diashow-Einstellungen =================
export function viewSlideshow() {
  const c = slideCfg();
  const page = h('div.page');
  const rerender = () => page.replaceWith(viewSlideshow());
  const choice = (label, key, opts, onPick) => h('section.section', null, h('h3.section-title', null, label),
    h('div.choice', null, ...Object.entries(opts).map(([k, l]) => h('button.choice-btn' + (String(c[key]) === String(k) ? '.on' : ''), { onclick: () => { saveSlide({ [key]: isNaN(+k) ? k : +k, ...(key === 'source' ? { sourceSet: true } : {}) }); onPick?.(k); rerender(); } }, l))));
  page.append(
    h('div.page-head', null, h('a.icon-btn', { href: '#fotos', 'aria-label': 'Zurück' }, icon('left')), h('h1', null, 'Diashow')),
    h('p.muted', null, 'Wird FamilyHub eine Weile nicht bedient, startet eine animierte Diashow mit euren Immich-Fotos – ideal für ein Tablet an der Wand. Antippen beendet sie.'),
    h('button.btn.primary.big.more-btn', { onclick: async () => { const { openWall } = await import('./wall.js'); openWall({ screensaver: true }); } }, icon('photo', 18), 'Vorschau starten'),
    choice('Starten nach Inaktivität', 'idleMin', { 0: 'Aus', 1: '1 Minute', 2: '2 Minuten', 5: '5 Minuten', 10: '10 Minuten', 30: '30 Minuten' }),
    choice('Fotos auf diesem Gerät', 'source', SOURCES, (k) => { if (k === 'albums') setTimeout(albumPicker, 50); }),
    c.source === 'albums' ? h('button.btn.tonal', { onclick: albumPicker }, '🗂️ ', c.albums.length ? `${c.albums.length} Album/Alben gewählt – ändern` : 'Alben auswählen') : '',
    familyCard(rerender),
    choice('Bildwechsel', 'interval', { 6: 'alle 6 s', 12: 'alle 12 s', 20: 'alle 20 s', 30: 'alle 30 s', 60: 'jede Minute' }),
    choice('Animation', 'effect', EFFECTS),
    choice('Anzeige', 'overlay', OVERLAYS),
    h('div.menu', null, h('label.menu-row.switch-row', null, h('span.mt', null, h('b', null, 'Datum & Ort einblenden'), h('small', null, 'z. B. „23. Juli 2021 · vor 5 Jahren · Graz“')),
      h('span.switch', null, h('input', { type: 'checkbox', checked: c.captions, onchange: (e) => saveSlide({ captions: e.target.checked }) }), h('span.track')))),
    h('p.hint', null, 'Tipp für ein Wand-Tablet: Android-Einstellungen → Display → „Bildschirm-Timeout“ hochsetzen und das Tablet am Ladekabel lassen. Während der Diashow bleibt der Bildschirm an.'));
  return page;
}

/** Familien-Standard: welches Immich-Album die Diashow auf allen Geräten zeigt (solange dort nichts anderes gewählt ist). */
function familyCard(rerender) {
  const box = h('section.section', null, h('h3.section-title', null, '👪 Familien-Diashow'), h('div.card.fam-album', null, h('p.soft', null, 'Wird geladen …')));
  const card = box.lastChild;
  store.request('api/v2/photo-albums').then((r) => {
    const f = r.family || { ids: [], names: [] };
    card.replaceChildren(
      f.ids.length
        ? h('div.fa-row', null, h('span.fa-ic', null, icon('photo', 22)), h('div', null, h('b', null, f.names.map((n) => `„${n}“`).join(', ')), h('small', null, `${f.count} Medien · ${f.auto ? 'automatisch erkannt' : 'für die Familie festgelegt'}`)))
        : h('div', null, h('b', null, 'Kein Album „Familien-Diashow“ gefunden'), h('p.hint', null, 'Legt in Immich ein Album mit diesem Namen an – bis dahin zeigt die Diashow zufällige Fotos.')),
      h('p.hint', null, 'Gilt für alle Geräte, auf denen oben „Familien-Diashow“ gewählt ist (Standard).'),
      h('div.btn-row.wrap', null,
        h('button.btn.small.tonal', { onclick: () => albumPicker({ title: 'Alben für die Familien-Diashow', initial: f.auto ? [] : f.ids, save: async (ids) => { await store.request('api/v2/photo-family', { method: 'POST', body: { albums: ids } }); toast(ids.length ? 'Familien-Diashow festgelegt' : 'Automatisch: Album „Familien-Diashow“'); rerender(); } }) }, icon('edit', 16), 'Album ändern'),
        !f.auto ? h('button.btn.small.ghost', { onclick: async () => { await store.request('api/v2/photo-family', { method: 'POST', body: { albums: [] } }); rerender(); } }, 'Automatisch') : null));
  }).catch((e) => card.replaceChildren(h('p.status.bad', null, '○ ' + e.message)));
  return box;
}

function albumPicker(opts = {}) {
  const sel = new Set(opts.initial || slideCfg().albums);
  sheet((s) => {
    const list = h('div.menu', null, h('p.soft', null, 'Alben werden geladen …'));
    store.request('api/v2/photo-albums').then((r) => {
      const draw = () => list.replaceChildren(...r.albums.map((a) => h('button.menu-row', { onclick: () => { sel.has(a.id) ? sel.delete(a.id) : sel.add(a.id); draw(); } },
        h('span.check' + (sel.has(a.id) ? '.on' : ''), null, icon('check', 16)), h('span.mt', null, h('b', null, a.name), h('small', null, `${a.count} Medien`)))));
      if (!r.albums.length) list.replaceChildren(h('p.soft', null, 'Keine Alben in Immich.')); else draw();
    }).catch((e) => list.replaceChildren(h('p.status.bad', null, e.message)));
    return h('div.sheet-body', null, h('h2.sheet-title', null, opts.title || 'Alben für dieses Gerät'), list,
      h('div.btn-row', null, h('button.btn.ghost', { onclick: () => s.close() }, 'Abbrechen'), h('button.btn.primary', { onclick: () => { if (opts.save) { s.close(); opts.save([...sel]); return; } saveSlide({ albums: [...sel], source: 'albums', sourceSet: true }); s.close(); location.hash = 'diashow'; window.dispatchEvent(new HashChangeEvent('hashchange')); } }, 'Übernehmen')));
  }, { tall: true, label: 'Alben' });
}
