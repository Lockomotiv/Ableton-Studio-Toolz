// Schnell-Erfassung: sprechen oder tippen → FamilyHub versteht Termin / Aufgabe / Einkauf.
import { h, icon, sheet, toast, fmt, fill } from './ui.js';
import { parse, describe, repeatLabel, shoppingCategory } from './nlp.js';
import { store } from './store.js';
import { members, refreshNative, childMode, completeTask } from './domain.js';
import { listen, stop as stopVoice, cancel as cancelVoice, voiceAvailable } from './voice.js';
import { haptic, speak } from './native.js';
import { openEditor } from './editors.js';
import { detectCommand } from './commands.js';
import { agenda, openTasks, today } from './domain.js';
import { choresFor, balance, toggleChore } from './household.js';
import { mealsOn } from './kitchen.js';
import { guessCategory } from './budget.js';
import { lessonsOn } from './family.js';
import { pickups } from './waste.js';
import { addItem } from './shopping.js';
import { weather } from './weather.js';
import { ymd, addDays } from './nlp.js';

/** Daten für Sprachfragen ("Was steht heute an?") */
function commandContext() {
  const now = new Date(); const d = (n) => ymd(addDays(now, n));
  const kid = childMode();
  return {
    members: kid ? [kid] : members(), meId: kid?.id || store.config.meId,
    today: today(), tomorrow: d(1), dayAfter: d(2), weekEnd: d(6), yearEnd: d(365),
    dayLabel: (x) => fmt.dayLabel(x).replace(/^(Heute|Morgen|Übermorgen)$/, (m) => m.toLowerCase()),
    events: (a, b) => agenda(a, b, { filter: false }),
    openTasks: openTasks({ filter: false }),
    shopping: store.list('shopping').filter((x) => !x.done),
    meals: (x) => mealsOn(x), choresFor: (x, mid) => choresFor(x, mid), balance: (mid) => balance(mid),
    guessCategory, lessons: (mid, x) => lessonsOn(mid, x), pickups: (a, b) => pickups(a, b), weather: () => weather(),
  };
}

const EXAMPLES = [
  'Morgen um 15 Uhr Zahnarzt mit Lena',
  'Milch, Eier und Brot auf die Einkaufsliste',
  'Fußball jeden Dienstag um 17 Uhr für Ben',
  'Erinnere mich Freitag an die Brotdosen',
  'Am Freitag gibt es Pizza zum Abendessen',
  'Was steht heute an?',
  'Lena hat den Tisch gedeckt',
  'Elternabend am 3.12. um 19:30 Uhr',
  'Papa muss morgen den Müll rausbringen',
  'Oma Geburtstag am 14. März',
];

const KIND = { event: ['Termin', 'calendar'], task: ['Aufgabe', 'tasks'], shopping: ['Einkauf', 'cart'], meal: ['Essen', 'meal'] };
const SLOT_LABEL = { breakfast: 'Frühstück', lunch: 'Mittag', dinner: 'Abend' };

export function openCapture({ mode = voiceAvailable() ? 'voice' : 'text', text = '', kind = null, date = null } = {}) {
  let parsed = null;
  let overrides = {};
  let listening = false;
  let api;
  const ui = {};

  const ctx = () => ({ members: members(), meId: store.config.meId, now: new Date() });

  let command = null;
  function reparse(t) {
    command = !kind && t.trim() ? detectCommand(t, commandContext()) : null;
    if (command && childMode() && command.type === 'action' && !(command.action.kind === 'message' || (command.action.kind === 'chore' && command.action.memberId === childMode().id))) command = null;
    if (command) { parsed = null; renderCommand(); return; }
    parsed = t.trim() ? parse(t, ctx()) : null;
    if (parsed && kind) parsed = coerceKind(parsed, kind);
    if (parsed && date && !/\d|heute|morgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag/i.test(t) && parsed.kind !== 'shopping') parsed.date = date;
    if (parsed && childMode() && !parsed.memberIds.length) parsed.memberIds = [childMode().id];
    overrides = {};
    renderPreview();
  }

  function current() { return parsed ? { ...parsed, ...overrides } : null; }

  function renderCommand() {
    ui.save.disabled = false;
    ui.save.replaceChildren(icon('check', 20), command.type === 'answer' ? 'OK' : 'Abhaken');
    fill(ui.preview, h('div.pv-card.answer', null,
      h('small.answer-kind', null, command.type === 'answer' ? '💬 ' + command.title : '✅ ' + command.title),
      h('p.answer-text', null, command.type === 'answer' ? command.text : command.label)));
  }

  function runCommand() {
    const c = command; api.close();
    if (c.type === 'answer') return;
    const a = c.action;
    if (a.kind === 'chore') { const ch = store.get('chores', a.choreId); if (ch) toggleChore(ch, a.memberId, today()); }
    else if (a.kind === 'task') { const tk = store.get('tasks', a.taskId); if (tk) { const r = completeTask(tk); toast('Erledigt 🎉', { label: 'Rückgängig', run: () => { r.undo(); refreshNative(); } }); } }
    else if (a.kind === 'budget') { const it = store.put('budget', { kind: 'entry', type: a.type, amount: a.amount, category: a.category, note: a.note, date: today(), memberId: store.config.meId || null }); toast('Im Haushaltsbuch eingetragen 💶', { label: 'Rückgängig', run: () => store.del('budget', it.id) }); }
    else if (a.kind === 'message') { const author = childMode() || members().find((m) => m.id === store.config.meId); if (!author) { toast('Bitte unter „Familie“ festlegen, wer dieses Handy nutzt'); return; } store.put('messages', { text: a.text, authorId: author.id, reactions: {}, pinned: false }); toast('An die Pinnwand geschrieben 💬'); }
    else if (a.kind === 'shopping') { const before = a.ids.map((id) => store.get('shopping', id)).filter(Boolean); for (const it of before) store.put('shopping', { ...it, done: true, doneAt: Date.now() }); toast('Abgehakt 🛒', { label: 'Rückgängig', run: () => before.forEach((it) => store.put('shopping', it)) }); }
    refreshNative(); haptic('success');
    if (store.config.voiceSpeak && mode === 'voice') speak(c.speak);
  }

  function renderPreview() {
    const p = current();
    if (!p) { ui.preview.replaceChildren(h('div.examples', null, h('div.examples-title', null, 'Zum Beispiel'), ...EXAMPLES.slice(0, 4).map((ex) => h('button.example', { onclick: () => { ui.input.value = ex; reparse(ex); ui.input.focus(); } }, '„' + ex + '“')))); ui.save.disabled = true; ui.save.replaceChildren(icon('check', 20), 'Speichern'); return; }
    ui.save.disabled = false;
    if (ui.save.textContent !== 'Speichern') ui.save.replaceChildren(icon('check', 20), 'Speichern');
    const kindRow = h('div.seg', { role: 'tablist' }, ...Object.entries(KIND).map(([k, [label, ic]]) => h('button.seg-btn' + (p.kind === k ? '.on' : ''), { role: 'tab', 'aria-selected': p.kind === k, onclick: () => { haptic(); parsed = coerceKind(parsed, k); overrides = {}; renderPreview(); } }, icon(ic, 18), label)));
    const chips = [];
    if (p.kind === 'meal') {
      fill(ui.preview, kindRow, h('div.pv-card', null,
        h('input.pv-title', { value: p.title, 'aria-label': 'Gericht', oninput: (e) => { overrides.title = e.target.value; } }),
        h('div.chips', null, chip('calendar', p.date ? fmt.dayLabel(p.date) : 'Heute', () => pickDate(p)),
          ...Object.entries(SLOT_LABEL).map(([k, l]) => h('button.chip' + (p.slot === k ? '.removable' : ''), { onclick: () => { overrides.slot = k; renderPreview(); } }, l)))));
      return;
    }
    if (p.kind === 'shopping') {
      ui.preview.replaceChildren(kindRow, h('div.pv-card', null, h('div.pv-items', null, ...(p.items.length ? p.items : [{ name: p.title || '…' }]).map((it) => h('span.pill', null, it.name)))));
      return;
    }
    chips.push(chip('calendar', p.date ? fmt.dayLabel(p.date) : 'Kein Datum', () => pickDate(p)));
    if (p.kind === 'event' || p.time) chips.push(chip('clock', p.allDay ? 'Ganztägig' : p.time ? fmt.time(p.time) + (p.endTime ? '–' + fmt.time(p.endTime) : '') + ' Uhr' : 'Uhrzeit', () => pickTime(p)));
    if (p.repeat) chips.push(chip('repeat', repeatLabel(p.repeat), () => { overrides.repeat = null; renderPreview(); }, true));
    if (p.remindMin != null) chips.push(chip('bell', p.remindMin ? `${p.remindMin >= 60 ? p.remindMin / 60 + ' Std.' : p.remindMin + ' Min.'} vorher` : 'Erinnern', () => { overrides.remindMin = null; renderPreview(); }, true));
    if (p.priority) chips.push(chip('flag', 'Wichtig', () => { overrides.priority = false; renderPreview(); }, true));
    const mem = members();
    fill(ui.preview,
      kindRow,
      h('div.pv-card', null,
        h('input.pv-title', { value: p.title, 'aria-label': 'Titel', oninput: (e) => { overrides.title = e.target.value; } }),
        h('div.chips', null, ...chips),
        mem.length ? h('div.chips.people', null, ...mem.map((m) => {
          const on = p.memberIds.includes(m.id);
          return h('button.person' + (on ? '.on' : ''), { style: { '--c': m.color }, onclick: () => { haptic(); const ids = new Set(current().memberIds); on ? ids.delete(m.id) : ids.add(m.id); overrides.memberIds = [...ids]; renderPreview(); } }, h('span.av', null, m.emoji || m.name[0]), m.name);
        })) : null,
      ),
    );
  }

  function chip(ic, label, onclick, removable) {
    return h('button.chip' + (removable ? '.removable' : ''), { onclick }, icon(ic, 16), label, removable ? icon('close', 14) : null);
  }

  function pickDate(p) {
    const inp = h('input', { type: 'date', value: p.date || '', style: { position: 'fixed', opacity: 0, pointerEvents: 'none' } });
    document.body.append(inp);
    inp.addEventListener('change', () => { overrides.date = inp.value || null; inp.remove(); renderPreview(); });
    inp.addEventListener('blur', () => setTimeout(() => inp.remove(), 300));
    inp.showPicker ? inp.showPicker() : inp.click();
  }
  function pickTime(p) {
    const inp = h('input', { type: 'time', value: p.time || '', style: { position: 'fixed', opacity: 0, pointerEvents: 'none' } });
    document.body.append(inp);
    inp.addEventListener('change', () => { overrides.time = inp.value || null; overrides.allDay = !inp.value; inp.remove(); renderPreview(); });
    inp.addEventListener('blur', () => setTimeout(() => inp.remove(), 300));
    inp.showPicker ? inp.showPicker() : inp.click();
  }

  function save() {
    if (command) return runCommand();
    const p = current();
    if (!p) return;
    const created = commit(p);
    api.close();
    haptic('success');
    const summary = describe(p, { members: members() });
    toast('Gespeichert: ' + summary, { label: 'Rückgängig', run: () => { created.forEach(([col, id]) => store.del(col, id)); refreshNative(); } });
    if (store.config.voiceSpeak && mode === 'voice') speak('Erledigt. ' + summary + '.');
  }

  function startListening() {
    if (listening) { stopVoice(); return; }
    listening = true;
    ui.orb.classList.add('live');
    ui.status.textContent = 'Ich höre zu …';
    ui.transcript.textContent = '';
    haptic();
    listen({
      onPartial: (t) => { ui.transcript.textContent = t; ui.input.value = t; reparse(t); },
      onFinal: (t) => {
        ui.transcript.textContent = t; ui.input.value = t; reparse(t);
        if (command?.type === 'answer' && store.config.voiceSpeak !== false) speak(command.speak);
        else if (store.config.voiceAutoSave && (command || (current() && current().title))) setTimeout(save, 350);
      },
      onError: (msg) => { if (msg) ui.status.textContent = msg; },
      onLevel: (lv) => ui.orb.style.setProperty('--lv', Math.min(1, lv).toFixed(2)),
      onEnd: () => {
        listening = false; ui.orb.classList.remove('live'); ui.orb.style.setProperty('--lv', 0);
        if (command) ui.status.textContent = command.type === 'answer' ? 'Noch eine Frage? Einfach aufs Mikrofon tippen.' : 'Stimmt das? Dann „Abhaken“ tippen.';
        else if (current()) ui.status.textContent = 'Passt das so? Tippe zum Ändern.';
        else if (!ui.status.textContent.includes('.')) ui.status.textContent = 'Tippe aufs Mikrofon und sprich los.';
      },
    });
  }

  api = sheet((s) => {
    ui.status = h('p.cap-status', { 'aria-live': 'polite' }, mode === 'voice' ? 'Tippe aufs Mikrofon und sprich los.' : 'Schreib einfach, wie du es sagen würdest.');
    ui.transcript = h('p.cap-transcript');
    ui.orb = h('button.orb', { 'aria-label': 'Spracheingabe starten oder stoppen', onclick: startListening }, h('span.orb-ring'), icon('mic', 34));
    ui.input = h('textarea.cap-input', { rows: 2, placeholder: 'z. B. „Freitag 16 Uhr Kinderarzt mit Ben“', value: text, oninput: (e) => reparse(e.target.value), onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } } });
    ui.preview = h('div.preview');
    ui.save = h('button.btn.primary.big', { onclick: save }, icon('check', 20), 'Speichern');
    const voiceBlock = h('div.cap-voice' + (mode === 'voice' ? '' : '.hidden'), null, ui.orb, ui.transcript);
    const toggle = h('button.icon-btn', { 'aria-label': mode === 'voice' ? 'Tastatur' : 'Mikrofon', onclick: () => {
      mode = mode === 'voice' ? 'text' : 'voice';
      voiceBlock.classList.toggle('hidden', mode !== 'voice');
      toggle.replaceChildren(icon(mode === 'voice' ? 'keyboard' : 'mic'));
      if (mode === 'text') { cancelVoice(); ui.input.focus(); } else startListening();
    } }, icon(mode === 'voice' ? 'keyboard' : 'mic'));
    return h('div.sheet-body.capture', null,
      h('div.cap-head', null, h('h2.sheet-title', null, 'Was steht an?'), voiceAvailable() ? toggle : null),
      voiceBlock, ui.status, ui.input, ui.preview,
      h('div.btn-row', null,
        h('button.btn.ghost', { onclick: () => { const p = current(); s.close(); if (p?.kind === 'meal') { location.hash = 'essen'; return; } openEditor(p?.kind === 'event' ? 'events' : p?.kind === 'shopping' ? 'shopping' : 'tasks', null, p || {}); } }, 'Mehr Details'),
        ui.save));
  }, { tall: true, label: 'Neuer Eintrag', onClose: () => cancelVoice() });

  if (text) reparse(text); else renderPreview();
  if (mode === 'voice') setTimeout(startListening, 320);
  else setTimeout(() => ui.input.focus(), 300);
}

function coerceKind(p, k) {
  const q = { ...p, kind: k };
  if (k === 'shopping') {
    const src = p.items?.length ? p.items.map((i) => i.name) : (p.title || '').split(/\s*,\s*|\s+und\s+/);
    q.items = src.filter(Boolean).map((name) => ({ name, category: shoppingCategory(name) }));
    q.title = q.items.map((i) => i.name).join(', ');
  } else if (p.kind === 'shopping') {
    q.title = p.items.map((i) => i.name).join(', ') || p.title;
  }
  if (k === 'meal') { q.slot = q.slot || 'dinner'; if (!q.date) q.date = fmtToday(); }
  if (k === 'event' && !q.date) q.date = fmtToday();
  if (k === 'event' && !q.time) q.allDay = true;
  return q;
}
function fmtToday() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/** Speichert ein Parser-Ergebnis. Gibt [[collection, id], …] zurück. */
export function commit(p) {
  const created = [];
  if (p.kind === 'shopping') {
    const items = (p.items?.length ? p.items : [{ name: p.title, category: shoppingCategory(p.title) }]).filter((i) => i.name);
    for (const i of items) { const it = addItem(i.name, { silent: true }); if (it) created.push(['shopping', it.id]); }
  } else if (p.kind === 'meal') {
    const ex = store.list('meals').find((m) => m.date === p.date && m.slot === (p.slot || 'dinner'));
    const rec = store.list('recipes').find((r) => r.title.toLowerCase() === p.title.toLowerCase());
    const it = store.put('meals', { ...(ex || {}), date: p.date, slot: p.slot || 'dinner', title: rec ? rec.title : p.title, recipeId: rec?.id || null, emoji: rec?.emoji || null });
    created.push(['meals', it.id]);
  } else if (p.kind === 'event') {
    const it = store.put('events', { title: p.title, date: p.date, time: p.allDay ? null : p.time, endTime: p.allDay ? null : p.endTime, allDay: !!p.allDay || !p.time, memberIds: p.memberIds, repeat: p.repeat, remindMin: p.remindMin ?? (p.time ? store.config.remindDefault : null), createdBy: store.config.meId });
    created.push(['events', it.id]);
  } else {
    const it = store.put('tasks', { title: p.title, date: p.date, time: p.time, memberIds: p.memberIds, repeat: p.repeat, remindMin: p.remindMin, priority: !!p.priority, done: false, createdBy: store.config.meId });
    created.push(['tasks', it.id]);
  }
  refreshNative();
  return created;
}
