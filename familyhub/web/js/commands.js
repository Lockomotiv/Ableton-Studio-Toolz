// Sprachbefehle, die keine neuen Einträge anlegen: Fragen beantworten und Dinge abhaken.
// Reine Funktion – alle Daten kommen über `ctx`, damit sie ohne App getestet werden kann.
//
//   detectCommand("Was steht heute an?", ctx) → { type: 'answer', title, text, speak }
//   detectCommand("Lena hat den Tisch gedeckt", ctx) → { type: 'action', label, action: {kind:'chore', …} }
//   → null, wenn es ein normaler Eintrag ist (dann übernimmt der Parser aus nlp.js)

const norm = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'und', 'mit', 'für', 'von', 'zum', 'zur', 'im', 'in', 'am', 'an', 'auf', 'aus', 'hat', 'ist', 'sind', 'haben', 'heute', 'schon', 'jetzt', 'gerade', 'mal', 'bitte', 'erledigt', 'fertig', 'gemacht', 'ab', 'hake', 'abhaken']);
// Verben in Partizip-Form ("gedeckt", "rausgebracht") auf einen Stamm bringen, damit "Tisch decken" ≈ "Tisch gedeckt"
function stem(w) {
  return w.replace(/^(raus|rein|aus|auf|ab|ein|weg|zu|an|mit|hin|her|vor)?(ge)?(?=\S{3,})/, '').replace(/(en|et|t|n|e|s)$/, '');
}
function words(s) { return norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)); }
/** Anteil der Titelwörter, die (als Stamm) im Satz vorkommen */
export function similarity(title, sentence) {
  const tw = words(title).map(stem); if (!tw.length) return 0;
  const sw = new Set(words(sentence).map(stem));
  const sws = [...sw];
  let hit = 0;
  for (const t of tw) if (sw.has(t) || sws.some((s) => s.length > 3 && t.length > 3 && (s.startsWith(t) || t.startsWith(s)))) hit++;
  return hit / tw.length;
}

function findMember(text, members) {
  const t = ' ' + norm(text) + ' ';
  for (const m of members) for (const n of [m.name, ...(m.aliases || [])]) if (n && t.includes(' ' + norm(n) + ' ')) return m;
  return null;
}
const joinDe = (a) => (a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' und ' + a[a.length - 1]);
const t12 = (t) => (t ? t.replace(/^0/, '').replace(':00', '') + ' Uhr' : '');

/**
 * ctx = { members, meId, today, tomorrow,
 *         events(dateFrom, dateTo) → [{title,date,time,allDay,memberIds}],
 *         openTasks: [{id,title,date,memberIds}], shopping: [{name}],
 *         meals(date) → [{slot,title}], choresFor(date, memberId) → [{chore,memberId,done}],
 *         balance(memberId) → number, weekEnd }
 */
export function detectCommand(input, ctx) {
  const raw = String(input || '').trim();
  const t = norm(raw);
  if (!t) return null;
  const isQuestion = /\?\s*$/.test(raw) || /^(was|wann|wie|welche[rsn]?|wer|gibt es|haben wir|steht|habe ich|hab ich|muss ich|müssen wir|sag mir|zeig mir|lies)\b/.test(t);
  const who = findMember(raw, ctx.members || []);

  // ---------- Pinnwand: "Schreib an die Pinnwand: Bin um 6 zuhause" ----------
  const pin = raw.match(/^\s*(?:schreib(?:e)?\s+)?(?:(?:eine\s+)?nachricht\s+)?(?:an\s+(?:die\s+)?(?:pinnwand|familie|alle)|auf\s+die\s+pinnwand|pinnwand)\s*[:,-]?\s+(.{2,})$/i);
  if (pin && ctx.postMessage !== false) return { type: 'action', title: 'Pinnwand', label: `💬 „${pin[1].trim()}“`, speak: 'Nachricht an die Pinnwand geschrieben.', action: { kind: 'message', text: pin[1].trim().replace(/^./, (c) => c.toUpperCase()) } };

  // ---------- Haushaltsbuch: "35 Euro bei Rewe ausgegeben", "Kindergeld 250 € bekommen" ----------
  const money = raw.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)(?![\p{L}])/iu);
  if (money && !isQuestionStart(t)) {
    const amount = parseFloat(money[1].replace(',', '.'));
    const income = /\b(bekommen|erhalten|eingenommen|gutgeschrieben|eingegangen|kindergeld|gehalt|lohn)\b/i.test(raw);
    const expense = /\b(ausgegeben|bezahlt|gezahlt|gekostet|überwiesen|eingekauft|getankt)\b/i.test(raw);
    if (amount > 0 && (income || expense)) {
      const note = raw.replace(money[0], ' ').replace(/\b(ich|wir|habe|haben|hab|heute|gerade|für|bei|im|in|beim|am|ausgegeben|bezahlt|gezahlt|gekostet|überwiesen|bekommen|erhalten|eingenommen|gutgeschrieben|eingegangen)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      const category = income ? (/kindergeld/i.test(raw) ? 'Kindergeld' : /gehalt|lohn/i.test(raw) ? 'Gehalt' : 'Sonstige Einnahme') : (ctx.guessCategory ? ctx.guessCategory(raw) : 'Sonstiges');
      const cleanNote = note.toLowerCase() === category.toLowerCase() ? '' : note;
      const eur = amount.toLocaleString('de-DE', { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 });
      return { type: 'action', title: 'Haushaltsbuch', label: `${income ? '➕' : '➖'} ${eur} € · ${category}${cleanNote ? ' · ' + cleanNote : ''}`, speak: `${eur} Euro ${income ? 'Einnahme' : 'für ' + category} eingetragen.`, action: { kind: 'budget', type: income ? 'in' : 'out', amount, category, note: cleanNote.replace(/^./, (c) => c.toUpperCase()) } };
    }
  }

  // ---------- Fragen ----------
  if (isQuestion) {
    // Schule: "Was hat Lena morgen in der Schule?", "Wie lange hat Ben heute Schule?"
    if (/schule|unterricht|stundenplan|fächer|stunden hat/.test(t) && ctx.lessons) {
      const day = /übermorgen/.test(t) ? ctx.dayAfter : /morgen/.test(t) && !/heute/.test(t) ? ctx.tomorrow : ctx.today;
      const label = day === ctx.today ? 'heute' : day === ctx.tomorrow ? 'morgen' : 'übermorgen';
      const kids = who ? [who] : (ctx.members || []).filter((m) => m.role === 'child');
      const parts = kids.map((k) => [k, ctx.lessons(k.id, day)]).map(([k, l]) => (l.length ? `${k.name} hat ${label} ${joinDe(l.map((x) => x.subject))} – bis ${t12(l[l.length - 1].end)}` : `${k.name} hat ${label} keinen Unterricht`));
      if (!parts.length) return answer('Stundenplan', 'Es ist noch kein Stundenplan eingetragen.');
      return answer('Stundenplan', parts.join('. ') + '.');
    }
    // Essen: "Was gibt es heute (zu essen | zum Abendessen)?"
    if (/^(was|wer kocht).*(essen|gibt es|gibts|kochen)/.test(t) && !/kaufen|einkauf/.test(t)) {
      const day = /morgen/.test(t) && !/heute/.test(t) ? ctx.tomorrow : ctx.today;
      const label = day === ctx.today ? 'heute' : 'morgen';
      const meals = ctx.meals(day);
      if (!meals.length) return answer('Essensplan', `Für ${label} ist noch nichts geplant.`);
      const SL = { breakfast: 'zum Frühstück', lunch: 'mittags', dinner: 'abends' };
      return answer('Essensplan', `${cap(label)} gibt es ${joinDe(meals.map((m) => (meals.length > 1 ? `${SL[m.slot] || ''} ${m.title}` : m.title).trim()))}.`);
    }
    // Einkauf: "Was steht auf der Einkaufsliste?", "Was müssen wir kaufen?"
    if (/einkauf|kaufen|besorgen|brauchen wir/.test(t)) {
      const items = ctx.shopping.map((s) => s.name);
      if (!items.length) return answer('Einkaufsliste', 'Die Einkaufsliste ist leer.');
      return answer('Einkaufsliste', `${items.length} ${items.length === 1 ? 'Sache' : 'Sachen'}: ${joinDe(items.slice(0, 12))}${items.length > 12 ? ' und mehr' : ''}.`);
    }
    // Sterne: "Wie viele Sterne hat Ben?"
    if (/sterne|punkte/.test(t)) {
      const ms = who ? [who] : (ctx.members || []).filter((m) => m.role === 'child');
      if (!ms.length) return answer('Sterne', 'Ich weiß nicht, für wen. Sag zum Beispiel: Wie viele Sterne hat Ben?');
      return answer('Sterne', ms.map((m) => `${m.name} hat ${ctx.balance(m.id)} ${ctx.balance(m.id) === 1 ? 'Stern' : 'Sterne'}`).join('. ') + '.');
    }
    // Ämter: "Was muss Lena heute noch machen?"
    if (/(amt|ämter|dienst|machen|erledigen|aufgaben|zu tun|todo)/.test(t)) {
      const target = who || (ctx.meId && /\b(ich|mich|mir)\b/.test(t) ? (ctx.members || []).find((m) => m.id === ctx.meId) : null);
      const chores = target ? ctx.choresFor(ctx.today, target.id).filter((c) => !c.done).map((c) => c.chore.title) : [];
      const tasks = ctx.openTasks.filter((x) => x.date && x.date <= ctx.today && (!target || !x.memberIds?.length || x.memberIds.includes(target.id))).map((x) => x.title);
      const all = [...chores, ...tasks];
      const name = target ? (target.id === ctx.meId ? 'Du hast' : `${target.name} hat`) : 'Ihr habt';
      if (!all.length) return answer('Zu erledigen', `${name} heute nichts mehr zu erledigen. 🎉`);
      return answer('Zu erledigen', `${name} heute noch: ${joinDe(all.slice(0, 8))}.`);
    }
    // Termine: "Was steht heute an?", "Was haben wir morgen?", "Wann ist der Zahnarzt?"
    const whenMatch = t.match(/^wann (?:ist|sind|haben wir|habe ich|hat \S+)\s+(.+)$/);
    if (whenMatch) {
      const q = whenMatch[1];
      const evs = ctx.events(ctx.today, ctx.yearEnd || ctx.weekEnd).map((e) => [similarity(e.title, q), e]).filter(([s]) => s >= 0.5).sort((a, b) => b[0] - a[0] || a[1].date.localeCompare(b[1].date));
      if (!evs.length) return answer('Kalender', `Ich habe dazu keinen Termin gefunden.`);
      const e = evs[0][1];
      return answer('Kalender', `${e.title}: ${ctx.dayLabel(e.date)}${e.allDay || !e.time ? '' : ' um ' + t12(e.time)}.`);
    }
    if (/(heute|morgen|woche|wochenende|termin|steht an|ansteht|vor|kalender|plan)/.test(t)) {
      const week = /woche/.test(t);
      const day = /übermorgen/.test(t) ? ctx.dayAfter : /morgen/.test(t) && !/heute/.test(t) ? ctx.tomorrow : ctx.today;
      const evs = (week ? ctx.events(ctx.today, ctx.weekEnd) : ctx.events(day, day)).filter((e) => !who || !e.memberIds?.length || e.memberIds.includes(who.id));
      const label = week ? 'diese Woche' : day === ctx.today ? 'heute' : day === ctx.tomorrow ? 'morgen' : 'übermorgen';
      const forWho = who ? ` für ${who.name}` : '';
      if (!evs.length) return answer('Kalender', `${cap(label)} steht${forWho} nichts im Kalender.`);
      const parts = evs.slice(0, 8).map((e) => `${week ? ctx.dayLabel(e.date) + ' ' : ''}${e.allDay || !e.time ? '' : t12(e.time) + ' '}${e.title}`.trim());
      return answer('Kalender', `${cap(label)}${forWho} ${evs.length === 1 ? 'ist' : 'sind'} ${evs.length === 1 ? 'ein Termin' : evs.length + ' Termine'}: ${joinDe(parts)}${evs.length > 8 ? ' und weitere' : ''}.`);
    }
    return null;
  }

  // ---------- Erledigt melden ----------
  // nur echte Erledigt-Meldungen: "… ist erledigt", "… fertig.", "Hake … ab", "Lena hat … gedeckt"
  const doneCue = /\b(ist|sind|wurde|wurden)\s+(erledigt|fertig|gemacht)\b/.test(t) || /\b(erledigt|fertig|gemacht|geschafft|abgehakt)$/.test(t) || /^hake\b.*\bab$/.test(t) ||
    (who && /\b(hat|haben)\b/.test(t) && /\S+(t|en)$/.test(t) && /\b\S*ge\S+(t|en)$/.test(t));
  if (doneCue) {
    // Ämter der Person (oder aller Kinder) von heute
    const cand = [];
    const ms = who ? [who] : (ctx.members || []);
    for (const m of ms) for (const c of ctx.choresFor(ctx.today, m.id)) cand.push({ score: similarity(c.chore.title, raw), kind: 'chore', chore: c.chore, member: m, done: c.done });
    for (const x of ctx.openTasks) cand.push({ score: similarity(x.title, raw), kind: 'task', task: x });
    cand.sort((a, b) => b.score - a.score || (a.kind === 'chore' ? -1 : 1));
    const best = cand[0];
    if (best && best.score >= 0.5) {
      if (best.kind === 'chore') {
        if (best.done) return answer('Ämter', `${best.chore.title} ist für ${best.member.name} heute schon abgehakt. 👍`);
        return { type: 'action', title: 'Amt erledigt', label: `${best.chore.emoji || '⭐'} ${best.chore.title} – ${best.member.name} (+${best.chore.points || 1} ⭐)`, speak: `${best.chore.title} für ${best.member.name} abgehakt. Plus ${best.chore.points || 1} Sterne!`, action: { kind: 'chore', choreId: best.chore.id, memberId: best.member.id } };
      }
      return { type: 'action', title: 'Aufgabe erledigt', label: `☑ ${best.task.title}`, speak: `${best.task.title} ist erledigt.`, action: { kind: 'task', taskId: best.task.id } };
    }
    // "Milch ist gekauft" / "haben wir gekauft"
  }
  if (/\b(gekauft|besorgt|im wagen|eingekauft)\b/.test(t) && ctx.shopping.length) {
    const hits = ctx.shopping.filter((s) => similarity(s.name, raw) >= 0.99);
    if (/\balles\b/.test(t)) return { type: 'action', title: 'Einkauf', label: `Alle ${ctx.shopping.length} Artikel abhaken`, speak: 'Alles abgehakt.', action: { kind: 'shopping', ids: ctx.shopping.map((s) => s.id) } };
    if (hits.length) return { type: 'action', title: 'Einkauf', label: `🛒 ${joinDe(hits.map((s) => s.name))} abhaken`, speak: `${joinDe(hits.map((s) => s.name))} abgehakt.`, action: { kind: 'shopping', ids: hits.map((s) => s.id) } };
  }
  return null;
}

function isQuestionStart(t) { return /^(was|wann|wie|welche[rsn]?|wer|wo)\b/.test(t); }
function answer(title, text) { return { type: 'answer', title, text, speak: text.replace(/[🎉👍]/gu, '') }; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
