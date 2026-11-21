// Ausführliche Bearbeitungsmasken für Termine, Aufgaben, Einkauf und Familienmitglieder.
import { h, icon, sheet, toast, confirmSheet } from './ui.js';
import { store } from './store.js';
import { members, deleteEvent, refreshNative, MEMBER_COLORS, MEMBER_EMOJI, childMode } from './domain.js';
import { shoppingCategory, SHOPPING_CATEGORY_ORDER, ymd } from './nlp.js';
import { haptic } from './native.js';

const REPEATS = [['', 'Nie'], ['daily', 'Täglich'], ['weekdays', 'Werktags (Mo–Fr)'], ['weekly', 'Wöchentlich'], ['weekly2', 'Alle 2 Wochen'], ['monthly', 'Monatlich'], ['yearly', 'Jährlich']];
const REMINDERS = [['', 'Keine'], ['0', 'Zur Startzeit'], ['10', '10 Minuten vorher'], ['30', '30 Minuten vorher'], ['60', '1 Stunde vorher'], ['120', '2 Stunden vorher'], ['1440', '1 Tag vorher']];

function repeatToValue(r) { if (!r) return ''; if (r.freq === 'weekly' && r.interval === 2) return 'weekly2'; return r.freq; }
function valueToRepeat(v) { if (!v) return null; if (v === 'weekly2') return { freq: 'weekly', interval: 2 }; return { freq: v, interval: 1 }; }

function field(label, input, extra) { return h('label.field', null, h('span', null, label), input, extra); }
function select(options, value) { return h('select', null, ...options.map(([v, l]) => h('option', { value: v, selected: String(value ?? '') === v }, l))); }

function peoplePicker(selected) {
  const set = new Set(selected || []);
  const wrap = h('div.chips.people');
  const render = () => wrap.replaceChildren(...members().map((m) => h('button.person' + (set.has(m.id) ? '.on' : ''), { type: 'button', style: { '--c': m.color }, onclick: () => { haptic(); set.has(m.id) ? set.delete(m.id) : set.add(m.id); render(); } }, h('span.av', null, m.emoji || m.name[0]), m.name)));
  render();
  return { el: members().length ? field('Wer?', wrap) : h('p.hint', null, 'Tipp: Unter „Familie“ Personen anlegen, dann kannst du Einträge zuordnen.'), get: () => [...set] };
}

export function openEditor(col, item, defaults = {}) {
  if (col === 'events') return editEvent(item, defaults);
  if (col === 'tasks') return editTask(item, defaults);
  if (col === 'shopping') return editShopping(item, defaults);
  if (col === 'members') return editMember(item);
}

export function editEvent(ev, d = {}) {
  const base = ev ? store.get('events', ev.id) || ev : null;
  const v = { title: '', date: ymd(new Date()), time: '', endTime: '', allDay: false, memberIds: childMode() ? [childMode().id] : [], repeat: null, remindMin: store.config.remindDefault, location: '', notes: '', ...d, ...(base || {}) };
  if (!base && d.kind === 'event' && !d.time) v.allDay = true;
  const f = {};
  sheet((s) => {
    const ppl = peoplePicker(v.memberIds);
    f.allDay = h('input', { type: 'checkbox', checked: !!v.allDay, onchange: () => times.classList.toggle('hidden', f.allDay.checked) });
    const times = h('div.row2' + (v.allDay ? '.hidden' : ''), null,
      field('Von', f.time = h('input', { type: 'time', value: v.time || '' })),
      field('Bis', f.endTime = h('input', { type: 'time', value: v.endTime || '' })));
    return h('form.sheet-body', { onsubmit: (e) => { e.preventDefault(); save(); } },
      h('h2.sheet-title', null, base ? 'Termin bearbeiten' : 'Neuer Termin'),
      field('Was?', f.title = h('input', { value: v.title, placeholder: 'z. B. Kinderarzt', required: true, autofocus: !base })),
      h('div.row2', null,
        field('Datum', f.date = h('input', { type: 'date', value: v.date || '', required: true })),
        field('Bis (optional)', f.endDate = h('input', { type: 'date', value: v.endDate || '' }))),
      h('label.switch', null, f.allDay, h('span.track'), h('span', null, 'Ganztägig')),
      times,
      ppl.el,
      h('div.row2', null,
        field('Wiederholen', f.repeat = select(REPEATS, repeatToValue(v.repeat))),
        field('Erinnern', f.remind = select(REMINDERS, v.remindMin ?? ''))),
      field('Ort', f.location = h('input', { value: v.location || '', placeholder: 'optional' })),
      field('Notiz', f.notes = h('textarea', { rows: 2, value: v.notes || '', placeholder: 'optional' })),
      h('div.btn-row', null,
        base && !childMode() ? h('button.btn.danger-ghost', { type: 'button', onclick: remove }, icon('trash', 18), 'Löschen') : h('span'),
        h('button.btn.primary', { type: 'submit' }, 'Speichern')));
    function save() {
      const t = f.title.value.trim(); if (!t) return f.title.focus();
      const allDay = f.allDay.checked || !f.time.value;
      store.put('events', { ...(base || {}), title: t, date: f.date.value, endDate: f.endDate.value && f.endDate.value > f.date.value ? f.endDate.value : null, allDay, time: allDay ? null : f.time.value, endTime: allDay ? null : f.endTime.value || null, memberIds: ppl.get(), repeat: valueToRepeat(f.repeat.value), remindMin: f.remind.value === '' ? null : +f.remind.value, location: f.location.value.trim(), notes: f.notes.value.trim(), createdBy: base?.createdBy || store.config.meId });
      refreshNative(); s.close(); toast(base ? 'Termin aktualisiert' : 'Termin gespeichert');
    }
    async function remove() {
      let mode = 'all';
      if (base.repeat) {
        const r = await confirmSheet({ title: 'Serientermin löschen', text: `„${base.title}“ wiederholt sich.`, ok: 'Alle Termine der Serie', extra: 'Nur diesen Termin', danger: true });
        if (!r) return; mode = r === 'extra' ? 'one' : 'all';
      }
      const undo = deleteEvent(ev, mode);
      refreshNative(); s.close(); toast('Termin gelöscht', { label: 'Rückgängig', run: () => { undo(); refreshNative(); } });
    }
  }, { tall: true, label: 'Termin' });
}

export function editTask(t, d = {}) {
  const base = t ? store.get('tasks', t.id) || t : null;
  const v = { title: '', date: '', time: '', memberIds: childMode() ? [childMode().id] : [], repeat: null, remindMin: null, priority: false, notes: '', ...d, ...(base || {}) };
  const f = {};
  sheet((s) => {
    const ppl = peoplePicker(v.memberIds);
    return h('form.sheet-body', { onsubmit: (e) => { e.preventDefault(); save(); } },
      h('h2.sheet-title', null, base ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'),
      field('Was ist zu tun?', f.title = h('input', { value: v.title, placeholder: 'z. B. Müll rausbringen', required: true, autofocus: !base })),
      h('div.row2', null,
        field('Fällig am', f.date = h('input', { type: 'date', value: v.date || '' })),
        field('Uhrzeit', f.time = h('input', { type: 'time', value: v.time || '' }))),
      ppl.el,
      h('div.row2', null,
        field('Wiederholen', f.repeat = select(REPEATS, repeatToValue(v.repeat))),
        field('Erinnern', f.remind = select(REMINDERS, v.remindMin ?? ''))),
      h('label.switch', null, f.prio = h('input', { type: 'checkbox', checked: !!v.priority }), h('span.track'), h('span', null, 'Wichtig')),
      field('Notiz', f.notes = h('textarea', { rows: 2, value: v.notes || '', placeholder: 'optional' })),
      h('div.btn-row', null,
        base && !childMode() ? h('button.btn.danger-ghost', { type: 'button', onclick: remove }, icon('trash', 18), 'Löschen') : h('span'),
        h('button.btn.primary', { type: 'submit' }, 'Speichern')));
    function save() {
      const title = f.title.value.trim(); if (!title) return f.title.focus();
      const rep = valueToRepeat(f.repeat.value);
      store.put('tasks', { ...(base || {}), title, date: f.date.value || (rep ? ymd(new Date()) : null), time: f.time.value || null, memberIds: ppl.get(), repeat: rep, remindMin: f.remind.value === '' ? null : +f.remind.value, priority: f.prio.checked, notes: f.notes.value.trim(), done: base?.done || false });
      refreshNative(); s.close(); toast(base ? 'Aufgabe aktualisiert' : 'Aufgabe gespeichert');
    }
    function remove() {
      store.del('tasks', base.id); refreshNative(); s.close();
      toast('Aufgabe gelöscht', { label: 'Rückgängig', run: () => store.put('tasks', base) });
    }
  }, { tall: true, label: 'Aufgabe' });
}

export function editShopping(it, d = {}) {
  const base = it ? store.get('shopping', it.id) : null;
  const v = { name: '', amount: '', category: '', ...d, ...(base || {}) };
  if (!v.name && d.title) v.name = d.title;
  const f = {};
  const api = sheet((s) => h('form.sheet-body', { onsubmit: (e) => { e.preventDefault(); save(); } },
    h('h2.sheet-title', null, base ? 'Artikel bearbeiten' : 'Artikel hinzufügen'),
    field('Artikel', f.name = h('input', { value: v.name, required: true, autofocus: true })),
    h('div.row2', null,
      field('Menge', f.amount = h('input', { value: v.amount || '', placeholder: 'z. B. 2 Pakete' })),
      field('Bereich', f.cat = select(SHOPPING_CATEGORY_ORDER.map((c) => [c, c]), v.category || shoppingCategory(v.name)))),
    h('div.btn-row', null,
      base ? h('button.btn.danger-ghost', { type: 'button', onclick: () => { store.del('shopping', base.id); s.close(); toast('Entfernt', { label: 'Rückgängig', run: () => store.put('shopping', base) }); } }, icon('trash', 18), 'Entfernen') : h('span'),
      h('button.btn.primary', { type: 'submit' }, 'Speichern'))), { label: 'Artikel' });
  function save() {
    const name = f.name.value.trim(); if (!name) return;
    store.put('shopping', { ...(base || { done: false }), name, amount: f.amount.value.trim(), category: f.cat.value });
    api.close();
  }
}

export function editMember(m) {
  const base = m ? store.get('members', m.id) : null;
  const used = new Set(members().map((x) => x.color));
  const v = { name: '', role: 'parent', color: MEMBER_COLORS.find((c) => !used.has(c)) || MEMBER_COLORS[0], emoji: '', birthday: '', ...(base || {}) };
  const f = {};
  sheet((s) => {
    let color = v.color; let emoji = v.emoji;
    const colors = h('div.swatches');
    const emojis = h('div.emojis');
    const drawC = () => colors.replaceChildren(...MEMBER_COLORS.map((c) => h('button.swatch' + (c === color ? '.on' : ''), { type: 'button', style: { background: c }, 'aria-label': 'Farbe', onclick: () => { color = c; drawC(); } })));
    const drawE = () => emojis.replaceChildren(h('button.emoji' + (!emoji ? '.on' : ''), { type: 'button', onclick: () => { emoji = ''; drawE(); } }, 'Aa'), ...MEMBER_EMOJI.map((e) => h('button.emoji' + (e === emoji ? '.on' : ''), { type: 'button', onclick: () => { emoji = e; drawE(); } }, e)));
    drawC(); drawE();
    return h('form.sheet-body', { onsubmit: (e) => {
      e.preventDefault();
      const name = f.name.value.trim(); if (!name) return;
      const saved = store.put('members', { ...(base || { order: members().length }), name, role: f.role.value, color, emoji, birthday: f.bday.value || null, aliases: f.alias.value.split(',').map((x) => x.trim()).filter(Boolean) });
      if (f.bday.value && !base?.birthdayEventId) {
        const evt = store.put('events', { title: `Geburtstag ${name}`, date: f.bday.value, allDay: true, repeat: { freq: 'yearly', interval: 1 }, memberIds: [saved.id], remindMin: null });
        store.put('members', { ...saved, birthdayEventId: evt.id });
      }
      if (!store.config.meId && f.role.value === 'parent') store.saveConfig({ meId: saved.id });
      s.close(); toast(base ? 'Gespeichert' : `${name} ist jetzt dabei`);
    } },
    h('h2.sheet-title', null, base ? base.name : 'Neues Familienmitglied'),
    field('Name', f.name = h('input', { value: v.name, required: true, autofocus: !base, placeholder: 'z. B. Lena' })),
    field('Weitere Namen für die Sprachsteuerung', f.alias = h('input', { value: (v.aliases || []).join(', '), placeholder: 'z. B. Mama, Schatz (mit Komma)' })),
    h('div.row2', null,
      field('Rolle', f.role = select([['parent', 'Elternteil'], ['child', 'Kind'], ['other', 'Andere']], v.role)),
      field('Geburtstag', f.bday = h('input', { type: 'date', value: v.birthday || '' }))),
    field('Farbe', colors),
    field('Symbol', emojis),
    h('div.btn-row', null,
      base ? h('button.btn.danger-ghost', { type: 'button', onclick: async () => { if (await confirmSheet({ title: `${base.name} entfernen?`, text: 'Termine und Aufgaben bleiben erhalten.', ok: 'Entfernen', danger: true })) { store.del('members', base.id); s.close(); } } }, icon('trash', 18), 'Entfernen') : h('span'),
      h('button.btn.primary', { type: 'submit' }, 'Speichern')));
  }, { tall: true, label: 'Familienmitglied' });
}
