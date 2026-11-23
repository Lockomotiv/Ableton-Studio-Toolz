// Dokumente der Familie (liegen auf dem Pi): Impfpass, Ausweise, Verträge, Zeugnisse, Garantien …
//   documents { name, category, fileId, type, size, memberIds, note }
import { h, icon, toast, sheet, confirmSheet, mono } from './ui.js';
import { store } from './store.js';
import { members, childMode } from './domain.js';
import { openUrl, viaApp } from './native.js';
import { avatars } from './views.js';

const CATS = [['id', '🪪 Ausweise & Urkunden'], ['health', '💉 Gesundheit & Impfpass'], ['school', '🏫 Schule & Kita'], ['contracts', '📄 Verträge & Versicherungen'], ['receipts', '🧾 Rechnungen & Garantien'], ['other', '📁 Sonstiges']];
const fmtSize = (n) => (n > 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');

let fileKey = null;
async function fileUrl(d) {
  if (!fileKey) fileKey = (await store.request('api/v2/files-key')).key;
  return `${await store.resolveBase()}api/v2/files/${d.fileId}?key=${encodeURIComponent(fileKey)}`;
}

export function viewDocuments() {
  const page = h('div.page');
  page.append(h('div.page-head', null, h('a.icon-btn', { href: '#mehr', 'aria-label': 'Zurück' }, icon('left')), h('h1', null, 'Dokumente'),
    store.serverEnabled() && !childMode() ? h('button.icon-btn.primary', { 'aria-label': 'Dokument hinzufügen', onclick: upload }, icon('plus')) : null));
  if (!store.serverEnabled()) {
    page.append(h('div.card.tip', null, h('p', null, 'Dokumente werden sicher auf eurem Pi gespeichert – nicht in einer fremden Cloud. Dafür die App zuerst mit dem Pi verbinden.'), h('a.btn.primary', { href: '#sync' }, icon('link', 18), 'Mit dem Pi verbinden')));
    return page;
  }
  const docs = store.list('documents').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!docs.length) page.append(h('div.card.tip', null, h('b', null, 'Wichtiges griffbereit'), h('p', null, 'Impfpass-Foto, Krankenkassenkarten, Schulbescheinigung, Mietvertrag, Garantiebelege … als PDF oder Foto. Alles liegt auf eurem Pi, die ganze Familie hat Zugriff.'), childMode() ? null : h('button.btn.primary', { onclick: upload }, icon('upload', 18), 'Erstes Dokument hochladen')));
  for (const [k, label] of CATS) {
    const list = docs.filter((d) => (d.category || 'other') === k);
    if (!list.length) continue;
    page.append(h('section.section', null, h('h3.section-title', null, label), h('div.menu', null, ...list.map((d) => h('button.menu-row', { onclick: () => showDoc(d) },
      h('span.mi.emoji-mi', null, /pdf/.test(d.type) ? '📕' : /image/.test(d.type) ? '🖼️' : '📄'),
      h('span.mt', null, h('b', null, d.name), h('small', null, [fmtSize(d.size || 0), d.note].filter(Boolean).join(' · '))), avatars(d.memberIds))))));
  }
  return page;
}

function upload() {
  const input = h('input', { type: 'file', accept: 'application/pdf,image/*,.doc,.docx,.txt', style: { display: 'none' } });
  document.body.append(input);
  input.addEventListener('change', () => {
    const file = input.files[0]; input.remove();
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return toast('Die Datei ist größer als 15 MB.');
    details({ name: file.name.replace(/\.[a-z0-9]+$/i, ''), file });
  });
  input.click();
}

function details({ name, file, doc }) {
  const f = {}; const sel = new Set(doc?.memberIds || []);
  const ppl = h('div.chips.people');
  const drawP = () => ppl.replaceChildren(...members().map((m) => h('button.person' + (sel.has(m.id) ? '.on' : ''), { type: 'button', style: { '--c': m.color }, onclick: () => { sel.has(m.id) ? sel.delete(m.id) : sel.add(m.id); drawP(); } }, h('span.av', null, mono(m)), m.name)));
  drawP();
  const st = h('p.status');
  const guess = /impf|kranken|arzt|befund|rezept/i.test(name) ? 'health' : /ausweis|pass|urkunde|geburt/i.test(name) ? 'id' : /schul|kita|zeugnis/i.test(name) ? 'school' : /vertrag|versicherung|police/i.test(name) ? 'contracts' : /rechnung|garantie|beleg|quittung/i.test(name) ? 'receipts' : 'other';
  sheet((s) => h('form.sheet-body', { onsubmit: async (e) => {
    e.preventDefault();
    const meta = { name: f.name.value.trim() || name, category: f.cat.value, memberIds: [...sel], note: f.note.value.trim() };
    if (doc) { store.put('documents', { ...doc, ...meta }); s.close(); return; }
    st.className = 'status'; st.textContent = '◌ Wird auf den Pi hochgeladen …';
    try {
      const data = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = fail; r.readAsDataURL(file); });
      const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/octet-stream');
      const r = await store.request('api/v2/files', { method: 'POST', body: { name: file.name, type, data }, timeout: 120000 });
      fileKey = r.key;
      store.put('documents', { ...meta, fileId: r.fileId, type, size: r.size });
      s.close(); toast('Dokument gespeichert 📄');
    } catch (err) { st.className = 'status bad'; st.textContent = '○ ' + err.message; }
  } },
  h('h2.sheet-title', null, doc ? 'Dokument bearbeiten' : 'Dokument speichern'),
  h('label.field', null, h('span', null, 'Name'), f.name = h('input', { value: doc?.name || name, required: true })),
  h('label.field', null, h('span', null, 'Bereich'), f.cat = h('select', null, ...CATS.map(([k, l]) => h('option', { value: k, selected: (doc?.category || guess) === k }, l)))),
  members().length ? h('label.field', null, h('span', null, 'Gehört zu'), ppl) : null,
  h('label.field', null, h('span', null, 'Notiz'), f.note = h('input', { value: doc?.note || '', placeholder: 'z. B. gültig bis 2031' })),
  st,
  h('div.btn-row', null, h('button.btn.ghost', { type: 'button', onclick: () => s.close() }, 'Abbrechen'), h('button.btn.primary', { type: 'submit' }, doc ? 'Speichern' : 'Hochladen'))), { tall: true, label: 'Dokument' });
}

function showDoc(d) {
  sheet((s) => {
    const preview = h('div.doc-preview');
    if (/image/.test(d.type)) fileUrl(d).then((u) => preview.append(h('img', { src: viaApp(u), alt: d.name }))).catch(() => {});
    return h('div.sheet-body', null, h('h2.sheet-title', null, d.name), d.note ? h('p.muted', null, d.note) : null, preview,
      h('div.btn-col', null,
        h('button.btn.primary', { onclick: async () => openUrl(await fileUrl(d)) }, icon('external', 18), 'Öffnen'),
        childMode() ? null : h('button.btn.tonal', { onclick: () => { s.close(); details({ name: d.name, doc: d }); } }, icon('edit', 18), 'Bearbeiten'),
        childMode() ? null : h('button.btn.danger-ghost', { onclick: async () => {
          if (!await confirmSheet({ title: `„${d.name}“ löschen?`, text: 'Die Datei wird vom Pi entfernt.', ok: 'Löschen', danger: true })) return;
          try { await store.request(`api/v2/files/${d.fileId}/delete`, { method: 'POST', body: {} }); } catch { /* Datei evtl. schon weg */ }
          store.del('documents', d.id); s.close();
        } }, icon('trash', 18), 'Löschen')));
  }, { tall: true, label: d.name });
}
