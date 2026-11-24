// Ämter (Haushaltsplan), Routinen und Sterne-/Belohnungssystem.
//
// Datenmodell (alle Sammlungen werden über den Server synchronisiert):
//   chores     { title, emoji, points, memberIds, days:[0..6] (leer = täglich), rotate }
//   routines   { title, emoji, period: 'morning'|'evening'|'day', memberIds, steps:[{t,e}], points, days }
//   rewards    { title, emoji, cost }
//   points     Punktebuch: { memberId, delta, reason, date, kind:'chore'|'routine'|'redeem'|'bonus', ref }
//              Abgehakte Ämter haben eine feste ID (c_<chore>_<member>_<datum>) – so ist Abhaken idempotent.
//   routinelog { routineId, memberId, date, done:[Schrittindex] }
import { uniqGlyphs } from './ui.js';
import { h, icon, toast, sheet, confirmSheet, promptSheet, fmt, mono } from './ui.js';
import { store } from './store.js';
import { members, member, childMode, today } from './domain.js';
import { ymd, addDays } from './nlp.js';
import { haptic } from './native.js';
import { celebrate, confetti, counter, progressVar } from './fx.js';
import { checkDailyBonus, DAILY_BONUS, levelOf, badgesOf, primeBadges, emblem, starJar, LEVELS } from './gamify.js';
export { confetti };

const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const PERIODS = { morning: ['Morgens', '🌅'], day: ['Tagsüber', '☀️'], evening: ['Abends', '🌙'] };
const CHORE_EMOJI = ['🧹', '🍽️', '🗑️', '🛏️', '🧺', '🐶', '🪴', '🧸', '🚿', '📚', '🦷', '👕', '🥛', '🚲', '🎒', '⭐'];
const REWARD_EMOJI = ['🍦', '🎮', '📺', '🎬', '🍕', '🧁', '🎁', '⚽', '🛝', '📖', '🎨', '💶', '🏊', '🌙', '🎡', '🧩'];

const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '');
export const choreKey = (choreId, memberId, date) => `c_${safe(choreId)}_${safe(memberId)}_${date.replace(/-/g, '')}`.slice(0, 64);
const routineKey = (rid, mid, date) => `r_${safe(rid)}_${safe(mid)}_${date.replace(/-/g, '')}`.slice(0, 64);
const routineBonusKey = (rid, mid, date) => `b_${safe(rid)}_${safe(mid)}_${date.replace(/-/g, '')}`.slice(0, 64);

function dueOn(item, date) {
  const wd = fmt.parse(date).getDay();
  return !item.days || !item.days.length || item.days.includes(wd);
}

/** Bei "rotate" wechselt die zuständige Person jede Woche (Ämterplan-Klassiker). */
export function assigneesFor(chore, date) {
  const ids = (chore.memberIds || []).filter((id) => member(id));
  if (!chore.rotate || ids.length < 2) return ids;
  const d = fmt.parse(date);
  const week = Math.floor((d - new Date(2024, 0, 1)) / (7 * 864e5));
  return [ids[week % ids.length]];
}

export function balance(memberId) {
  return store.list('points').filter((p) => p.memberId === memberId).reduce((s, p) => s + (p.delta || 0), 0);
}
export function earnedOn(memberId, date) {
  return store.list('points').filter((p) => p.memberId === memberId && p.date === date && p.delta > 0).reduce((s, p) => s + p.delta, 0);
}

export function choresFor(date, memberId = null) {
  const out = [];
  for (const c of store.list('chores')) {
    if (!dueOn(c, date)) continue;
    for (const mid of assigneesFor(c, date)) {
      if (memberId && mid !== memberId) continue;
      const done = !!store.get('points', choreKey(c.id, mid, date));
      out.push({ chore: c, memberId: mid, done });
    }
  }
  return out;
}

export function toggleChore(chore, memberId, date, fromEl) {
  const key = choreKey(chore.id, memberId, date);
  if (store.get('points', key)) { store.del('points', key); checkDailyBonus(memberId, date); haptic(); return false; }
  const rect = fromEl?.getBoundingClientRect?.();
  store.put('points', { id: key, memberId, delta: chore.points || 1, reason: chore.title, date, kind: 'chore', ref: chore.id });
  // Tagesziel: alle Ämter des Tages erledigt → Bonus obendrauf
  const bonus = checkDailyBonus(memberId, date) ? DAILY_BONUS : 0;
  celebrate(memberId, (chore.points || 1) + bonus, bonus ? `Tagesziel geschafft – +${bonus} Bonus` : null, rect);
  return true;
}

export function routinesFor(date, memberId = null) {
  const out = [];
  for (const r of store.list('routines')) {
    if (!dueOn(r, date)) continue;
    for (const mid of (r.memberIds || []).filter((id) => member(id))) {
      if (memberId && mid !== memberId) continue;
      const log = store.get('routinelog', routineKey(r.id, mid, date));
      out.push({ routine: r, memberId: mid, done: log?.done || [] });
    }
  }
  const order = { morning: 0, day: 1, evening: 2 };
  return out.sort((a, b) => (order[a.routine.period] ?? 1) - (order[b.routine.period] ?? 1));
}

export function toggleStep(routine, memberId, date, idx, fromEl) {
  const key = routineKey(routine.id, memberId, date);
  const log = store.get('routinelog', key) || { id: key, routineId: routine.id, memberId, date, done: [] };
  const done = new Set(log.done);
  done.has(idx) ? done.delete(idx) : done.add(idx);
  store.put('routinelog', { ...log, done: [...done] });
  const complete = routine.steps.length && routine.steps.every((_, i) => done.has(i));
  const bonusKey = routineBonusKey(routine.id, memberId, date);
  if (complete && !store.get('points', bonusKey) && routine.points) {
    store.put('points', { id: bonusKey, memberId, delta: routine.points, reason: routine.title, date, kind: 'routine', ref: routine.id });
    celebrate(memberId, routine.points, `${routine.title} geschafft!`, fromEl?.getBoundingClientRect?.());
  } else if (!complete && store.get('points', bonusKey)) store.del('points', bonusKey);
  else haptic();
}

// ---------------- Ansichten ----------------
function memberHead(m, extra) {
  return h('div.kid-head', { style: { '--c': m.color } }, h('span.av.lg', { style: { '--c': m.color } }, mono(m)), h('div', null, h('b', null, m.name), extra ? h('small', null, extra) : null), starBadge(m));
}

function dateSwitch(state, rerender) {
  const label = state.date === today() ? 'Heute' : fmt.dayLabel(state.date);
  return h('div.date-switch', null,
    h('button.icon-btn', { 'aria-label': 'Vortag', onclick: () => { state.date = ymd(addDays(fmt.parse(state.date), -1)); rerender(); } }, icon('left')),
    h('b', null, label),
    h('button.icon-btn', { 'aria-label': 'Nächster Tag', onclick: () => { state.date = ymd(addDays(fmt.parse(state.date), 1)); rerender(); } }, icon('right')));
}

const choreState = { date: null };
export function viewChores() {
  if (!choreState.date) choreState.date = today();
  const page = h('div.subpage');
  const rerender = () => page.replaceWith(viewChores());
  const kid = childMode();
  const list = choresFor(choreState.date, kid?.id);
  page.append(dateSwitch(choreState, rerender));
  if (!store.list('chores').length) {
    page.append(h('div.card.tip', null, h('b', null, 'Ämterplan'), h('p', null, 'Wer deckt den Tisch, wer bringt den Müll raus? Lege wiederkehrende Ämter an. Jedes erledigte Amt bringt Sterne, die gegen Belohnungen getauscht werden können.'), kid ? null : h('button.btn.tonal', { onclick: () => editChore(null) }, icon('plus', 18), 'Erstes Amt anlegen')));
    return page;
  }
  const byMember = {};
  for (const it of list) (byMember[it.memberId] ||= []).push(it);
  const ms = members().filter((m) => byMember[m.id]);
  if (!ms.length) page.append(h('p.soft', null, 'An diesem Tag stehen keine Ämter an.'));
  for (const m of ms) {
    const items = byMember[m.id];
    const doneN = items.filter((i) => i.done).length;
    page.append(h('section.kid-card', { style: { '--c': m.color } },
      memberHead(m, `${doneN} von ${items.length} erledigt`),
      h('div.progress', null, h('i', { style: { width: (doneN / items.length) * 100 + '%' } })),
      h('div.chore-grid', null, ...items.map((it) => h('button.chore' + (it.done ? '.done' : ''), {
        onclick: (e) => { toggleChore(it.chore, m.id, choreState.date, e.currentTarget); },
        oncontextmenu: (e) => { e.preventDefault(); if (!kid) editChore(it.chore); },
      }, h('span.ce', null, it.chore.emoji || '⭐'), h('span.ct', null, it.chore.title), h('span.cp', null, it.done ? '✓' : '+' + (it.chore.points || 1)))))));
  }
  if (!kid) {
    page.append(h('h3.section-title', null, 'Alle Ämter'), h('div.menu', null,
      ...store.list('chores').map((c) => h('button.menu-row', { onclick: () => editChore(c) }, h('span.mi.emoji-mi', null, c.emoji || '⭐'), h('span.mt', null, h('b', null, c.title), h('small', null, `${c.points || 1} ⭐ · ${c.days?.length ? c.days.map((d) => DAYS[d]).join(', ') : 'täglich'} · ${(c.memberIds || []).map((id) => member(id)?.name).filter(Boolean).join(', ') || 'niemand'}${c.rotate ? ' · wechselt wöchentlich' : ''}`)), icon('right', 18))),
      h('button.menu-row.add', { onclick: () => editChore(null) }, h('span.mi', null, icon('plus', 20)), h('span.mt', null, h('b', null, 'Amt hinzufügen')))));
  }
  return page;
}

function daysPicker(sel) {
  const set = new Set(sel || []);
  const wrap = h('div.days');
  const draw = () => wrap.replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map((d) => h('button.day-chip' + (set.has(d) ? '.on' : ''), { type: 'button', onclick: () => { set.has(d) ? set.delete(d) : set.add(d); draw(); } }, DAYS[d])));
  draw();
  return { el: wrap, get: () => [...set].sort() };
}
function memberPicker(sel) {
  const set = new Set(sel || []);
  const wrap = h('div.chips.people');
  const draw = () => wrap.replaceChildren(...members().map((m) => h('button.person' + (set.has(m.id) ? '.on' : ''), { type: 'button', style: { '--c': m.color }, onclick: () => { set.has(m.id) ? set.delete(m.id) : set.add(m.id); draw(); } }, h('span.av', null, mono(m)), m.name)));
  draw();
  return { el: wrap, get: () => [...set] };
}
const GUESS = [
  [/tisch|geschirr|spülmaschine|abwasch/i, '🍽️'], [/müll|abfall|tonne/i, '🗑️'], [/zimmer|aufräum|spielzeug/i, '🧸'], [/bett/i, '🛏️'],
  [/wäsche|kleidung/i, '🧺'], [/hund|katze|tier|füttern|gassi/i, '🐶'], [/blume|pflanz|gieß|garten/i, '🪴'], [/zähne|zahn/i, '🦷'],
  [/hausaufgabe|lesen|lernen|üben/i, '📚'], [/bad|dusch/i, '🚿'], [/staub|saug|fegen|putz/i, '🧹'], [/ranzen|schule/i, '🎒'],
  [/eis/i, '🍦'], [/tablet|handy|konsole|spiel|zocken|switch/i, '🎮'], [/fernseh|tv|serie/i, '📺'], [/kino|film/i, '🎬'], [/pizza/i, '🍕'],
  [/kuchen|backen|muffin/i, '🧁'], [/geld|taschengeld|euro/i, '💶'], [/schwimm|bad/i, '🏊'], [/länger auf|aufbleiben|wach/i, '🌙'],
  [/spielplatz|ausflug/i, '🛝'], [/buch|vorles/i, '📖'], [/mal|bastel/i, '🎨'], [/fußball|sport/i, '⚽'], [/überraschung|geschenk/i, '🎁'],
];
export function guessEmoji(title, fallback) { for (const [re, e] of GUESS) if (re.test(title)) return e; return fallback; }

function emojiPicker(list, cur) {
  let val = cur || null;
  const wrap = h('div.emojis');
  const draw = () => wrap.replaceChildren(...uniqGlyphs(list, val).map((e) => h('button.emoji' + (e === val ? '.on' : ''), { type: 'button', onclick: () => { val = e; draw(); } }, e)));
  draw();
  return { el: wrap, get: (title) => val || guessEmoji(title || '', list[0]) };
}
const field = (label, input) => h('label.field', null, h('span', null, label), input);

export function editChore(c) {
  const kids = members().filter((m) => m.role === 'child').map((m) => m.id);
  const v = { title: '', points: 2, memberIds: kids, days: [], rotate: false, ...(c || {}) };
  const f = {};
  const em = emojiPicker(CHORE_EMOJI, v.emoji);
  const ppl = memberPicker(v.memberIds);
  const days = daysPicker(v.days);
  sheet((s) => h('form.sheet-body', { onsubmit: (e) => {
    e.preventDefault();
    const title = f.title.value.trim(); if (!title) return;
    store.put('chores', { ...(c || {}), title, emoji: em.get(title), points: Math.max(1, +f.points.value || 1), memberIds: ppl.get(), days: days.get(), rotate: f.rotate.checked });
    s.close(); toast(c ? 'Amt gespeichert' : 'Amt angelegt');
  } },
  h('h2.sheet-title', null, c ? 'Amt bearbeiten' : 'Neues Amt'),
  field('Was?', f.title = h('input', { value: v.title, placeholder: 'z. B. Tisch decken', required: true, autofocus: !c })),
  field('Symbol', em.el),
  field('Wer?', ppl.el),
  h('label.switch', null, f.rotate = h('input', { type: 'checkbox', checked: !!v.rotate }), h('span.track'), h('span', null, 'Jede Woche abwechseln')),
  field('An welchen Tagen? (nichts gewählt = täglich)', days.el),
  field('Sterne pro Erledigung', f.points = h('input', { type: 'number', min: 1, max: 50, value: v.points, inputmode: 'numeric' })),
  h('div.btn-row', null,
    c ? h('button.btn.danger-ghost', { type: 'button', onclick: async () => { if (await confirmSheet({ title: `„${c.title}“ löschen?`, ok: 'Löschen', danger: true })) { store.del('chores', c.id); s.close(); } } }, icon('trash', 18), 'Löschen') : h('span'),
    h('button.btn.primary', { type: 'submit' }, 'Speichern'))), { tall: true, label: 'Amt' });
}

// ---------- Routinen ----------
const routineState = { date: null };
export function viewRoutines() {
  if (!routineState.date) routineState.date = today();
  const page = h('div.subpage');
  const rerender = () => page.replaceWith(viewRoutines());
  const kid = childMode();
  page.append(dateSwitch(routineState, rerender));
  const list = routinesFor(routineState.date, kid?.id);
  if (!store.list('routines').length) {
    page.append(h('div.card.tip', null, h('b', null, 'Routinen'), h('p', null, 'Feste Abläufe Schritt für Schritt – z. B. Morgenroutine: Anziehen, Zähne putzen, Ranzen packen. Kinder haken selbst ab und sammeln Sterne.'),
      kid ? null : h('div.btn-col', null,
        h('button.btn.tonal', { onclick: () => templateRoutine('morning') }, '🌅 Vorlage Morgenroutine'),
        h('button.btn.tonal', { onclick: () => templateRoutine('evening') }, '🌙 Vorlage Abendroutine'),
        h('button.btn.ghost', { onclick: () => editRoutine(null) }, icon('plus', 18), 'Eigene Routine'))));
    return page;
  }
  if (!list.length) page.append(h('p.soft', null, 'Heute keine Routinen.'));
  for (const { routine: r, memberId, done } of list) {
    const m = member(memberId);
    const pct = r.steps.length ? done.length / r.steps.length : 0;
    page.append(h('section.kid-card.routine' + (pct === 1 ? '.complete' : ''), { style: { '--c': m.color } },
      h('div.routine-head', null,
        h('span.big-emoji', null, r.emoji || PERIODS[r.period]?.[1] || '⭐'),
        h('div', null, h('b', null, r.title), h('small', null, `${m.name} · ${PERIODS[r.period]?.[0] || ''}${r.points ? ' · +' + r.points + ' ⭐' : ''}`)),
        h('span.ring', { style: { '--p': pct } }, h('span', null, `${done.length}/${r.steps.length}`)),
        kid ? null : h('button.icon-btn', { 'aria-label': 'Bearbeiten', onclick: () => editRoutine(r) }, icon('edit', 18))),
      h('div.steps-list', null, ...r.steps.map((st, i) => h('button.step-btn' + (done.includes(i) ? '.on' : ''), { onclick: (e) => toggleStep(r, memberId, routineState.date, i, e.currentTarget) },
        h('span.se', null, st.e || '•'), h('span.st', null, st.t), h('span.check' + (done.includes(i) ? '.on' : ''), null, icon('check', 16)))))));
  }
  if (!kid) page.append(h('button.btn.tonal.more-btn', { onclick: () => editRoutine(null) }, icon('plus', 18), 'Routine hinzufügen'));
  return page;
}

const TEMPLATES = {
  morning: { title: 'Morgenroutine', emoji: '🌅', period: 'morning', points: 3, steps: [['Aufstehen & Bett machen', '🛏️'], ['Anziehen', '👕'], ['Frühstücken', '🥣'], ['Zähne putzen', '🦷'], ['Ranzen & Brotdose', '🎒']] },
  evening: { title: 'Abendroutine', emoji: '🌙', period: 'evening', points: 3, steps: [['Spielsachen aufräumen', '🧸'], ['Schlafanzug an', '👕'], ['Zähne putzen', '🦷'], ['Kleidung für morgen', '🧦'], ['Vorlesen', '📖']] },
};
function templateRoutine(kind) {
  const t = TEMPLATES[kind];
  editRoutine(null, { ...t, steps: t.steps.map(([tt, e]) => ({ t: tt, e })), memberIds: members().filter((m) => m.role === 'child').map((m) => m.id) });
}

export function editRoutine(r, preset = {}) {
  const v = { title: '', emoji: '🌅', period: 'morning', points: 3, steps: [], memberIds: [], days: [], ...preset, ...(r || {}) };
  const f = {};
  let steps = v.steps.map((x) => ({ ...x }));
  const ppl = memberPicker(v.memberIds);
  const days = daysPicker(v.days);
  const list = h('div.step-edit');
  const draw = () => list.replaceChildren(...steps.map((st, i) => h('div.step-row', null,
    h('input.step-emoji', { value: st.e || '', maxlength: 4, 'aria-label': 'Symbol', oninput: (e) => { st.e = e.target.value; } }),
    h('input', { value: st.t, placeholder: 'Schritt', oninput: (e) => { st.t = e.target.value; } }),
    h('button.icon-btn', { type: 'button', 'aria-label': 'Entfernen', onclick: () => { steps.splice(i, 1); draw(); } }, icon('close', 18)))),
  h('button.btn.ghost.small', { type: 'button', onclick: () => { steps.push({ t: '', e: '✅' }); draw(); setTimeout(() => list.querySelector('.step-row:last-of-type input:not(.step-emoji)')?.focus(), 50); } }, icon('plus', 16), 'Schritt'));
  draw();
  sheet((s) => h('form.sheet-body', { onsubmit: (e) => {
    e.preventDefault();
    const title = f.title.value.trim(); if (!title) return;
    const clean = steps.filter((x) => x.t.trim()).map((x) => ({ t: x.t.trim(), e: x.e || '' }));
    if (!clean.length) return toast('Mindestens einen Schritt anlegen');
    store.put('routines', { ...(r || {}), title, emoji: f.emoji.value || v.emoji, period: f.period.value, points: Math.max(0, +f.points.value || 0), steps: clean, memberIds: ppl.get(), days: days.get() });
    s.close(); toast('Routine gespeichert');
  } },
  h('h2.sheet-title', null, r ? 'Routine bearbeiten' : 'Neue Routine'),
  h('div.row2', null, field('Name', f.title = h('input', { value: v.title, required: true })), field('Symbol', f.emoji = h('input', { value: v.emoji, maxlength: 4 }))),
  h('div.row2', null,
    field('Wann?', f.period = h('select', null, ...Object.entries(PERIODS).map(([k, [l, e]]) => h('option', { value: k, selected: v.period === k }, `${e} ${l}`)))),
    field('Sterne bei Abschluss', f.points = h('input', { type: 'number', min: 0, max: 50, value: v.points, inputmode: 'numeric' }))),
  field('Für wen?', ppl.el),
  field('Schritte', list),
  field('An welchen Tagen? (nichts = täglich)', days.el),
  h('div.btn-row', null,
    r ? h('button.btn.danger-ghost', { type: 'button', onclick: async () => { if (await confirmSheet({ title: `„${r.title}“ löschen?`, ok: 'Löschen', danger: true })) { store.del('routines', r.id); s.close(); } } }, icon('trash', 18), 'Löschen') : h('span'),
    h('button.btn.primary', { type: 'submit' }, 'Speichern'))), { tall: true, label: 'Routine' });
}

// ---------- Sterne & Belohnungen ----------
/** Sternezähler einer Person – Ziel der fliegenden Sterne, zählt beim Neuzeichnen hoch. */
export function starBadge(m, big = false) {
  return h('span.stars' + (big ? '.big' : ''), { 'data-stars': m.id, 'aria-label': `${balance(m.id)} Sterne` }, '⭐ ', counter('bal:' + m.id + (big ? ':b' : ''), balance(m.id)));
}
/** Sterne pro Tag einer Woche (Montag zuerst). */
export function weekPoints(memberId, start = weekStart(today())) {
  const days = [...Array(7)].map((_, i) => ymd(addDays(fmt.parse(start), i)));
  const pts = store.list('points').filter((p) => p.memberId === memberId && p.delta > 0);
  return days.map((d) => ({ date: d, pts: pts.filter((p) => p.date === d).reduce((s, p) => s + p.delta, 0) }));
}
export function weekStart(date) { const d = fmt.parse(date); return ymd(addDays(d, -((d.getDay() + 6) % 7))); }
/** Tage in Folge, an denen alle Ämter erledigt wurden (heute zählt, sobald fertig). */
export function streakDays(memberId) {
  let n = 0; let d = fmt.parse(today());
  for (let i = 0; i < 90; i++, d = addDays(d, -1)) {
    const list = choresFor(ymd(d), memberId);
    if (!list.length) continue;
    const all = list.every((c) => c.done);
    if (all) n++; else if (i > 0) break;
  }
  return n;
}
/** Fortschritt heute: Ämter + Routinenschritte. */
export function dayProgress(memberId, date = today()) {
  const ch = choresFor(date, memberId); const rt = routinesFor(date, memberId);
  const total = ch.length + rt.reduce((s, r) => s + r.routine.steps.length, 0);
  const done = ch.filter((c) => c.done).length + rt.reduce((s, r) => s + r.done.length, 0);
  return { done, total, chores: ch, routines: rt };
}
/** Nächstes Ziel: günstigste Belohnung über dem Kontostand; „bereit“ = sofort einlösbar. */
export function rewardGoal(memberId) {
  const bal = balance(memberId);
  const rewards = store.list('rewards').sort((a, b) => (a.cost || 0) - (b.cost || 0));
  const ready = rewards.filter((r) => r.cost <= bal);
  const next = rewards.find((r) => r.cost > bal) || null;
  return { bal, next, ready: ready[ready.length - 1] || null, p: next ? Math.min(1, bal / next.cost) : ready.length ? 1 : 0 };
}

/** Mini-Balken: Sterne je Wochentag (eine Reihe, Farbe = Person, heute hervorgehoben). */
export function weekBars(m, { labels = true } = {}) {
  const wk = weekPoints(m.id);
  const max = Math.max(4, ...wk.map((d) => d.pts));
  const td = today();
  const sum = wk.reduce((s, d) => s + d.pts, 0);
  return h('div.week-bars', { style: { '--c': m.color }, role: 'img', 'aria-label': `${m.name} diese Woche ${sum} Sterne: ` + wk.map((d) => `${fmt.WD[fmt.parse(d.date).getDay()]} ${d.pts}`).join(', ') },
    ...wk.map((d) => {
      const bar = h('i', { title: `${fmt.dayLabel(d.date)}: ${d.pts} Sterne` });
      progressVar(bar, `wk:${m.id}:${d.date}`, d.pts / max);
      return h('span.wb' + (d.date === td ? '.today' : '') + (d.date > td ? '.future' : ''), null,
        h('span.wb-track', null, bar),
        labels ? h('small', null, fmt.WD[fmt.parse(d.date).getDay()].slice(0, 2)) : null);
    }));
}

/** Ring um den Avatar: Tagesfortschritt. */
function ringAvatar(m, done, total, size = 'md') {
  const el = h('span.ring-av.' + size, { style: { '--c': m.color } }, h('span.av', { style: { '--c': m.color } }, mono(m)));
  progressVar(el, `day:${m.id}`, total ? done / total : 0);
  if (total && done === total) el.classList.add('full');
  return el;
}

/** Zielbalken zur nächsten Belohnung. */
function goalBar(m, g, big = false) {
  const fillEl = h('i');
  progressVar(fillEl, `goal:${m.id}`, g.p);
  const label = g.next ? h('span', null, 'Noch ', h('b', null, g.next.cost - g.bal), ` bis `, g.next.emoji || '🎁', ' ', g.next.title)
    : g.ready ? h('span', null, h('b', null, 'Einlösbar: '), g.ready.emoji || '🎁', ' ', g.ready.title) : h('span', null, 'Noch keine Belohnung festgelegt');
  return h('div.goal' + (big ? '.big' : '') + (!g.next && g.ready ? '.ready' : ''), { style: { '--c': m.color } },
    h('div.goal-track', null, fillEl), h('div.goal-label', null, label, g.next ? h('small', null, `${g.bal}/${g.next.cost}`) : null));
}

const kidsOf = () => members().filter((m) => m.role === 'child');

/** „Heute“ der Eltern: Sterne, Tagesfortschritt, Ziel und Woche je Kind. */
export function familyStarsCard() {
  const ms = kidsOf().concat(members().filter((m) => m.role !== 'child' && (balance(m.id) || dayProgress(m.id).total)));
  if (!ms.length || (!store.list('chores').length && !store.list('routines').length && !store.list('rewards').length && !store.list('points').length)) return null;
  return h('section.section', null,
    h('div.section-head', null, h('h3.section-title', null, '⭐ Ämter & Sterne'), h('a.link', { href: '#plan' }, 'Wochenplan')),
    h('div.card.stars-board', null, ...ms.map((m) => {
      const pr = dayProgress(m.id); const g = rewardGoal(m.id); const st = streakDays(m.id);
      return h('a.sb-row', { href: '#aemter', style: { '--c': m.color } },
        h('div.sb-top', null,
          ringAvatar(m, pr.done, pr.total),
          h('div.sb-main', null, h('b', null, m.name), h('small', null, pr.total ? `${pr.done} von ${pr.total} erledigt` : 'Heute nichts zu tun', st > 1 ? h('span.streak', null, ' · 🔥 ', st, ' Tage') : null)),
          starBadge(m)),
        h('div.sb-bottom', null, goalBar(m, g), weekBars(m, { labels: false })));
    })));
}

/** „Heute“ des Kindes: großer Sternezähler, Ziel, Ämter zum direkten Abhaken. */
export function kidHero(kid) {
  const pr = dayProgress(kid.id); const g = rewardGoal(kid.id); const st = streakDays(kid.id);
  const td = today();
  return h('div.kid-hero-wrap', null,
    h('section.kid-hero', { style: { '--c': kid.color } },
      h('div.kh-top', null,
        h('div.kh-count', null, starBadge(kid, true), h('small', null, 'Sterne')),
        h('div.kh-side', null,
          st > 0 ? h('span.kh-chip.fire', { style: { '--s': Math.min(st, 10) } }, '🔥 ', st, st === 1 ? ' Tag' : ' Tage') : null,
          h('span.kh-chip', null, '+', earnedOn(kid.id, td), ' heute'))),
      levelBar(kid),
      h('div.kh-goal', null,
        g.next || g.ready ? starJar(kid.id, g.p, (g.next || g.ready).emoji || '🎁') : null,
        goalBar(kid, g, true)),
      weekBars(kid),
      dailyGoal(kid, pr)),
    badgeStrip(kid),
    pr.chores.length ? h('section.section', null, h('h3.section-title', null, 'Deine Ämter heute', h('span.count-pill', null, `${pr.chores.filter((c) => c.done).length}/${pr.chores.length}`)),
      h('div.chore-grid.big', null, ...pr.chores.map((it) => h('button.chore' + (it.done ? '.done' : ''), { style: { '--c': kid.color }, onclick: (e) => toggleChore(it.chore, kid.id, td, e.currentTarget) },
        h('span.ce', null, it.chore.emoji || '⭐'), h('span.ct', null, it.chore.title), h('span.cp', null, it.done ? '✓' : '+' + (it.chore.points || 1) + ' ⭐'))))) : null,
    pr.routines.length ? h('div.routine-chips', null, ...pr.routines.map(({ routine: r, done }) => {
      const ring = h('span.ring', { style: { '--c': kid.color } }, h('span', null, `${done.length}/${r.steps.length}`));
      progressVar(ring, `rt:${kid.id}:${r.id}`, r.steps.length ? done.length / r.steps.length : 0);
      return h('a.routine-chip' + (done.length === r.steps.length ? '.complete' : ''), { href: '#routinen' }, ring, h('span', null, h('b', null, r.title), h('small', null, r.points ? `+${r.points} ⭐ wenn fertig` : '')));
    })) : null);
}

/** Level mit Fortschritt zum nächsten Level */
export function levelBar(m) {
  const lv = levelOf(m.id);
  const fillEl = h('i'); progressVar(fillEl, `lv:${m.id}`, lv.p);
  return h('button.level-bar', { style: { '--c': m.color }, onclick: () => levelInfo(m) }, emblem(lv.level, 'sm'),
    h('span.lv-main', null, h('span.lv-top', null, h('b', null, lv.name), h('small', null, `noch ${lv.toNext} ⭐ bis Level ${lv.level + 1}`)), h('span.lv-track', null, fillEl)));
}
function levelInfo(m) {
  const lv = levelOf(m.id);
  sheet((s) => h('div.sheet-body.moment', { style: { '--c': m.color } }, emblem(lv.level, 'xl'), h('p.moment-kicker', null, `Level ${lv.level}`), h('h2.sheet-title', null, lv.name),
    h('p.muted', null, `${lv.total} Sterne insgesamt gesammelt. Noch ${lv.toNext} bis Level ${lv.level + 1} (${LEVELS[Math.min(lv.level, LEVELS.length - 1)]}).`),
    h('div.level-ladder', null, ...LEVELS.map((n, i) => h('span.ll' + (i + 1 < lv.level ? '.done' : i + 1 === lv.level ? '.now' : ''), null, h('b', null, i + 1), n))),
    h('button.btn.primary', { onclick: () => s.close() }, 'Weiter sammeln')), { label: 'Level' });
}
/** Tagesziel: alle Ämter → Bonus */
function dailyGoal(m, pr) {
  if (pr.chores.length < 2) return null;
  const done = pr.chores.filter((c) => c.done).length; const all = done === pr.chores.length;
  return h('div.daily-goal' + (all ? '.won' : ''), null, h('span.dg-ic', null, all ? '🏆' : '🎯'),
    h('span', null, h('b', null, all ? 'Tagesziel geschafft!' : 'Tagesziel'), h('small', null, all ? `+${DAILY_BONUS} Bonus-Sterne verdient` : `Alle ${pr.chores.length} Ämter → +${DAILY_BONUS} Bonus · noch ${pr.chores.length - done}`)),
    h('span.dg-dots', null, ...pr.chores.map((c) => h('i' + (c.done ? '.on' : '')))));
}
/** Abzeichen kompakt (Dashboard) */
function badgeStrip(m) {
  primeBadges(m.id);
  const list = badgesOf(m.id);
  const on = list.filter((b) => b.on).length;
  return h('section.section', null, h('div.section-head', null, h('h3.section-title', null, 'Abzeichen', h('span.count-pill', null, `${on}/${list.length}`)), h('a.link', { href: '#sterne' }, 'Alle ansehen')),
    h('div.badge-row', null, ...list.map((b) => h('button.badge' + (b.on ? '.on' : ''), { onclick: () => badgeInfo(m, b), 'aria-label': b.t + (b.on ? '' : ' (noch gesperrt)') }, h('span.bd-ic', null, b.on ? b.e : icon('lock', 18)), h('small', null, b.t)))));
}
export function badgeWall(m) {
  primeBadges(m.id);
  return h('div.badge-grid', null, ...badgesOf(m.id).map((b) => h('button.badge' + (b.on ? '.on' : ''), { onclick: () => badgeInfo(m, b) }, h('span.bd-ic', null, b.on ? b.e : icon('lock', 18)), h('b', null, b.t), h('small', null, b.on ? b.d : (b.hint ? b.hint(m.id) : b.d)))));
}
function badgeInfo(m, b) {
  sheet((s) => h('div.sheet-body.moment', { style: { '--c': m.color } }, h('span.badge-big' + (b.on ? '' : '.locked'), null, b.on ? b.e : icon('lock', 40)), h('p.moment-kicker', null, b.on ? 'Abzeichen' : 'Noch gesperrt'), h('h2.sheet-title', null, b.t),
    h('p.muted', null, b.d + (!b.on && b.hint ? ` – bisher ${b.hint(m.id)}` : '')), h('button.btn.primary', { onclick: () => s.close() }, b.on ? 'Stark!' : 'Auf geht’s')), { label: 'Abzeichen' });
}

/** Wochenplan: wer hat an welchem Tag welches Amt – auf einen Blick, abhakbar. */
const planState = { start: null };
export function viewPlan() {
  if (!planState.start) planState.start = weekStart(today());
  const page = h('div.subpage');
  const rerender = () => page.replaceWith(viewPlan());
  const kid = childMode();
  const days = [...Array(7)].map((_, i) => ymd(addDays(fmt.parse(planState.start), i)));
  const td = today();
  const end = fmt.parse(days[6]);
  page.append(h('div.date-switch', null,
    h('button.icon-btn', { 'aria-label': 'Vorige Woche', onclick: () => { planState.start = ymd(addDays(fmt.parse(planState.start), -7)); rerender(); } }, icon('left')),
    h('b', null, days[0] === weekStart(td) ? 'Diese Woche' : `${fmt.parse(days[0]).getDate()}.${fmt.parse(days[0]).getMonth() + 1}. – ${end.getDate()}.${end.getMonth() + 1}.`),
    h('button.icon-btn', { 'aria-label': 'Nächste Woche', onclick: () => { planState.start = ymd(addDays(fmt.parse(planState.start), 7)); rerender(); } }, icon('right'))));
  const chores = store.list('chores');
  if (!chores.length) {
    page.append(h('div.card.tip', null, h('b', null, 'Wochenplan'), h('p', null, 'Hier seht ihr auf einen Blick, wer an welchem Tag welches Amt hat – und was schon erledigt ist. Legt dazu Ämter an.'), kid ? null : h('button.btn.tonal', { onclick: () => editChore(null) }, icon('plus', 18), 'Erstes Amt anlegen')));
    return page;
  }
  // Verteilung: Anteil der Ämter je Person in dieser Woche
  const load = {}; const doneBy = {}; const ptsBy = {};
  for (const d of days) for (const it of choresFor(d)) { load[it.memberId] = (load[it.memberId] || 0) + 1; if (it.done) doneBy[it.memberId] = (doneBy[it.memberId] || 0) + 1; ptsBy[it.memberId] = (ptsBy[it.memberId] || 0) + (it.chore.points || 1); }
  const ms = members().filter((m) => load[m.id]);
  const total = Object.values(load).reduce((s, n) => s + n, 0);
  page.append(h('section.card.share', null,
    h('div.share-bar', { role: 'img', 'aria-label': 'Verteilung: ' + ms.map((m) => `${m.name} ${load[m.id]}`).join(', ') }, ...ms.map((m) => h('i', { style: { '--c': m.color, flex: load[m.id] } }))),
    h('div.share-legend', null, ...ms.map((m) => {
      const pct = load[m.id] ? (doneBy[m.id] || 0) / load[m.id] : 0;
      return h('div.sl', { style: { '--c': m.color } }, h('span.av', { style: { '--c': m.color } }, mono(m)),
        h('span.sl-main', null, h('b', null, m.name), h('small', null, `${load[m.id]} Ämter · ${Math.round((load[m.id] / total) * 100)} %`)),
        h('span.sl-done', null, `${doneBy[m.id] || 0}/${load[m.id]}`, h('small', null, `${ptsBy[m.id]} ⭐ möglich`)), h('span.sl-bar', null, h('i', { style: { width: pct * 100 + '%' } })));
    }))));
  // Raster: Ämter × Tage
  const grid = h('div.plan-grid', { role: 'grid', style: { '--cols': 7 } },
    h('span.pg-corner'),
    ...days.map((d) => h('span.pg-day' + (d === td ? '.today' : ''), null, fmt.WD[fmt.parse(d).getDay()].slice(0, 2), h('b', null, fmt.parse(d).getDate()))));
  for (const c of chores) {
    grid.append(h('button.pg-chore', { onclick: () => (kid ? null : editChore(c)) }, h('span.pg-emo', null, c.emoji || '⭐'), h('span', null, c.title), h('small', null, `+${c.points || 1} ⭐`)));
    for (const d of days) {
      const cell = choresFor(d).filter((it) => it.chore.id === c.id);
      grid.append(h('div.pg-cell' + (d === td ? '.today' : ''), null, ...cell.map((it) => {
        const m = member(it.memberId);
        const can = d <= td && (!kid || kid.id === it.memberId);
        return h('button.pg-who' + (it.done ? '.done' : d < td ? '.missed' : ''), { style: { '--c': m.color }, disabled: !can, 'aria-label': `${c.title}, ${m.name}, ${fmt.dayLabel(d)}${it.done ? ', erledigt' : ''}`, onclick: (e) => toggleChore(c, m.id, d, e.currentTarget) }, it.done ? icon('check', 14) : mono(m));
      })));
    }
  }
  page.append(h('div.plan-scroll', null, grid),
    h('p.hint', null, kid ? 'Tippe auf deinen Kreis, wenn du ein Amt erledigt hast.' : 'Kreis antippen = erledigt. Amt antippen = bearbeiten (Tage, Personen, wöchentlich abwechseln).'));
  return page;
}

export function viewRewards() {
  const page = h('div.subpage');
  const kid = childMode();
  const ms = kid ? [kid] : kidsOf().concat(members().filter((m) => m.role !== 'child' && balance(m.id) !== 0));
  const rewards = store.list('rewards').sort((a, b) => (a.cost || 0) - (b.cost || 0));
  if (!ms.length) page.append(h('div.card.tip', null, h('p', null, 'Lege unter „Familie“ Kinder an (Rolle „Kind“), dann sammeln sie hier Sterne.'), h('a.btn.tonal', { href: '#familie' }, 'Zur Familie')));
  page.append(h('div.star-board', null, ...ms.map((m) => {
    const g = rewardGoal(m.id); const st = streakDays(m.id);
    const wk = weekPoints(m.id).reduce((s, d) => s + d.pts, 0);
    return h('div.star-card', { style: { '--c': m.color } },
      h('div.sc-head', null, h('span.av.lg', { style: { '--c': m.color } }, mono(m)), h('div', null, h('b', null, m.name), h('small', null, `diese Woche +${wk}`, st > 1 ? ` · 🔥 ${st} Tage` : ''))),
      h('div.star-count', null, starBadge(m, true)),
      levelBar(m),
      goalBar(m, g),
      weekBars(m),
      kid ? null : h('div.btn-row.wrap', null, h('button.btn.small.tonal', { onclick: () => bonus(m) }, '± Sterne'), h('button.btn.small.ghost', { onclick: () => history(m) }, 'Verlauf')));
  })));
  if (ms.length) page.append(h('h3.section-title', null, '🏅 Abzeichen'), ...ms.map((m) => h('div.badge-block', null, ms.length > 1 ? h('div.bb-head', null, h('span.av', { style: { '--c': m.color } }, mono(m)), h('b', null, m.name)) : null, badgeWall(m))));
  page.append(h('h3.section-title', null, '🎁 Belohnungen'));
  if (!rewards.length) page.append(h('p.soft', null, kid ? 'Noch keine Belohnungen – frag Mama oder Papa!' : 'Lege fest, wofür Sterne eingetauscht werden können – z. B. „30 Min. Tablet = 10 ⭐“.'));
  page.append(h('div.reward-grid', null, ...rewards.map((r) => {
    const ok = ms.filter((m) => balance(m.id) >= r.cost);
    return h('div.reward' + (ok.length ? '.ready' : ''), null,
      h('span.re', null, r.emoji || '🎁'), h('b', null, r.title), h('span.cost', null, `${r.cost} ⭐`),
      h('div.rw-progress', null, ...ms.map((m) => h('span.rwp', { style: { '--c': m.color }, title: `${m.name}: ${Math.min(balance(m.id), r.cost)}/${r.cost}` }, ms.length > 1 ? h('span.av', { style: { '--c': m.color } }, mono(m)) : null, h('span.rwp-track', null, h('i', { style: { width: Math.min(100, (Math.max(0, balance(m.id)) / r.cost) * 100) + '%' } }))))),
      h('div.btn-row.wrap', null,
        ...ms.map((m) => h('button.btn.small' + (balance(m.id) >= r.cost ? '.primary' : '.ghost'), { disabled: balance(m.id) < r.cost, onclick: () => redeem(r, m) }, ms.length > 1 ? m.name : 'Einlösen')),
        kid ? null : h('button.icon-btn', { 'aria-label': 'Bearbeiten', onclick: () => editReward(r) }, icon('edit', 16))));
  })));
  if (!kid) page.append(h('button.btn.tonal.more-btn', { onclick: () => editReward(null) }, icon('plus', 18), 'Belohnung hinzufügen'));
  return page;
}

async function redeem(r, m) {
  if (childMode()) {
    const { verifyParentPin } = await import('./more.js');
    if (!await verifyParentPin(`${r.title} für ${r.cost} ⭐ einlösen – Eltern bestätigen`)) return;
  } else if (!await confirmSheet({ title: `${r.emoji || '🎁'} ${r.title}`, text: `${m.name} löst ${r.cost} Sterne ein.`, ok: 'Einlösen' })) return;
  store.put('points', { memberId: m.id, delta: -r.cost, reason: r.title, date: today(), kind: 'redeem', ref: r.id });
  confetti(); toast(`🎉 ${m.name}: ${r.title}!`);
}

async function bonus(m) {
  const v = await promptSheet({ title: `Sterne für ${m.name}`, label: 'Anzahl (z. B. 5 oder -3)', type: 'tel', ok: 'Buchen' });
  const n = parseInt(v, 10); if (!n) return;
  const why = await promptSheet({ title: 'Wofür?', label: 'Grund (optional)', value: n > 0 ? 'Extra-Lob' : 'Korrektur' });
  store.put('points', { memberId: m.id, delta: n, reason: why || (n > 0 ? 'Bonus' : 'Abzug'), date: today(), kind: 'bonus' });
  if (n > 0) confetti();
}

function history(m) {
  const list = store.list('points').filter((p) => p.memberId === m.id).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60);
  sheet(() => h('div.sheet-body', null, h('h2.sheet-title', null, `Verlauf · ${m.name}`),
    list.length ? h('div.menu', null, ...list.map((p) => h('div.menu-row', null, h('span.mt', null, h('b', null, p.reason || '–'), h('small', null, fmt.dayLabel(p.date))), h('b.' + (p.delta > 0 ? 'plus' : 'minus'), null, (p.delta > 0 ? '+' : '') + p.delta)))) : h('p.soft', null, 'Noch keine Sterne.')), { tall: true, label: 'Verlauf' });
}

export function editReward(r) {
  const v = { title: '', cost: 10, ...(r || {}) };
  const f = {};
  const em = emojiPicker(REWARD_EMOJI, v.emoji);
  sheet((s) => h('form.sheet-body', { onsubmit: (e) => {
    e.preventDefault();
    const title = f.title.value.trim(); if (!title) return;
    store.put('rewards', { ...(r || {}), title, cost: Math.max(1, +f.cost.value || 1), emoji: em.get(title) });
    s.close();
  } },
  h('h2.sheet-title', null, r ? 'Belohnung bearbeiten' : 'Neue Belohnung'),
  field('Belohnung', f.title = h('input', { value: v.title, placeholder: 'z. B. 30 Min. extra Tablet', required: true, autofocus: !r })),
  field('Symbol', em.el),
  field('Kostet Sterne', f.cost = h('input', { type: 'number', min: 1, max: 9999, value: v.cost, inputmode: 'numeric' })),
  h('div.btn-row', null,
    r ? h('button.btn.danger-ghost', { type: 'button', onclick: () => { store.del('rewards', r.id); s.close(); } }, icon('trash', 18), 'Löschen') : h('span'),
    h('button.btn.primary', { type: 'submit' }, 'Speichern'))), { label: 'Belohnung' });
}

/** Kompakte Übersicht für „Heute“ – Kinder sehen ihre Sterne groß, Eltern die Familienübersicht. */
export function todayKidsCard() { const kid = childMode(); return kid ? kidHero(kid) : familyStarsCard(); }
