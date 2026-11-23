// Push-Benachrichtigungen vom Pi (für iPhones und Browser – die Android-App plant ihre Erinnerungen selbst).
// - Erinnerungen an Termine & Aufgaben (remindMin), Abfall am Vorabend
// - sofort: neue Nachricht auf der Pinnwand, neuer Termin / neue Aufgabe / neues Amt für mich
import crypto from 'node:crypto';
import { generateVapid, sendPush } from './webpush.js';
import { occurrences } from '../../web/js/recur.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (date, time) => { const [y, m, d] = date.split('-').map(Number); const [hh, mm] = (time || '09:00').split(':').map(Number); return new Date(y, m - 1, d, hh, mm).getTime(); };

export class Notifier {
  constructor(db, fetchRaw, { wastePickups = () => [], log = () => {} } = {}) {
    this.db = db; this.fetchRaw = fetchRaw; this.wastePickups = wastePickups; this.log = log;
    const s = db.data.secrets;
    if (!s.vapid) { s.vapid = generateVapid(); db.save(); }
    s.push = s.push || {}; s.pushSent = s.pushSent || {};
    this.last = Date.now() - 60e3;
  }
  get vapid() { return this.db.data.secrets.vapid; }
  get subs() { return this.db.data.secrets.push; }

  subscribe(sub, { memberId = null, device = 'Gerät' } = {}) {
    if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw Object.assign(new Error('Ungültiges Push-Abo'), { status: 400 });
    const id = crypto.createHash('sha256').update(sub.endpoint).digest('hex').slice(0, 24);
    this.subs[id] = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, memberId, device: String(device).slice(0, 60), created: Date.now() };
    this.db.save();
    return id;
  }
  unsubscribe(endpoint) {
    for (const [id, s] of Object.entries(this.subs)) if (s.endpoint === endpoint) delete this.subs[id];
    this.db.save();
  }

  async send(id, msg) {
    const sub = this.subs[id]; if (!sub) return null;
    try {
      const r = await sendPush(sub, msg, this.vapid, this.fetchRaw, { topic: msg.tag });
      if (r.status === 404 || r.status === 410) { delete this.subs[id]; this.db.save(); this.log(`Push-Abo ${sub.device} abgelaufen – entfernt`); }
      else if (r.status >= 400) this.log(`Push an ${sub.device} fehlgeschlagen: HTTP ${r.status} ${r.body}`);
      return r;
    } catch (e) { this.log(`Push an ${sub.device} fehlgeschlagen: ${e.message}`); return null; }
  }
  /** an alle (außer `exceptMember`), optional nur an Betroffene */
  async broadcast(msg, { forMembers = null, exceptMember = null } = {}) {
    const jobs = [];
    for (const [id, s] of Object.entries(this.subs)) {
      if (exceptMember && s.memberId === exceptMember) continue;
      if (forMembers && forMembers.length && s.memberId && !forMembers.includes(s.memberId)) continue;
      jobs.push(this.send(id, msg));
    }
    return Promise.all(jobs);
  }

  /** Nach jedem Abgleich: Neues für andere melden. `before` = Map col:id → existierte vorher */
  afterBatch(ops, existedBefore) {
    if (!Object.keys(this.subs).length) return;
    const members = this.db.data.members;
    for (const op of ops) {
      if (op.op !== 'put' || existedBefore.has(op.col + ':' + op.item?.id)) continue;
      const it = op.item;
      if (op.col === 'messages') {
        const who = members[it.authorId]?.name || 'Familie';
        this.broadcast({ title: `💬 ${who}`, body: String(it.text || '').slice(0, 180), tag: 'msg', url: '#pinnwand' }, { exceptMember: it.authorId });
      } else if (['events', 'tasks', 'chores'].includes(op.col) && it.memberIds?.length && !it.external) {
        const label = { events: 'Neuer Termin', tasks: 'Neue Aufgabe', chores: 'Neues Amt' }[op.col];
        const when = it.date ? ` · ${it.date.split('-').reverse().slice(0, 2).join('.')}.${it.time ? ' ' + it.time + ' Uhr' : ''}` : '';
        this.broadcast({ title: `${label}: ${it.title}`, body: `Für dich eingetragen${when}`, tag: op.col, url: op.col === 'chores' ? '#aemter' : op.col === 'tasks' ? '#aufgaben' : '#kalender' }, { forMembers: it.memberIds, exceptMember: it.createdBy || null });
      }
    }
  }

  /** Jede Minute: fällige Erinnerungen verschicken */
  async tick(now = Date.now()) {
    const subs = Object.entries(this.subs);
    const from = Math.max(this.last, now - 10 * 60e3); this.last = now;
    if (!subs.length) return 0;
    const sent = this.db.data.secrets.pushSent;
    const due = []; // [key, msg, forMembers]
    const d0 = new Date(now); const today = ymd(d0);
    const yest = ymd(new Date(now - 864e5)); const in2 = ymd(new Date(now + 2 * 864e5));
    for (const ev of Object.values(this.db.data.events)) {
      if (ev.deleted || ev.remindMin == null || !ev.time) continue;
      for (const o of occurrences(ev, yest, in2)) {
        const t = at(o.date, o.time) - o.remindMin * 60e3;
        if (t > from && t <= now) due.push([`e:${ev.id}:${o.date}`, { title: ev.title, body: `${o.remindMin ? 'Um ' + o.time + ' Uhr' : 'Jetzt'}${ev.location ? ' · ' + ev.location : ''}`, tag: 'ev-' + ev.id, url: '#kalender' }, ev.memberIds]);
      }
    }
    for (const tk of Object.values(this.db.data.tasks)) {
      if (tk.deleted || tk.done || tk.remindMin == null || !tk.date) continue;
      const t = at(tk.date, tk.time) - (tk.remindMin || 0) * 60e3;
      if (t > from && t <= now) due.push([`t:${tk.id}:${tk.date}`, { title: '☑ ' + tk.title, body: 'Aufgabe fällig', tag: 'task-' + tk.id, url: '#aufgaben' }, tk.memberIds]);
    }
    // Abfall: am Vorabend zur eingestellten Uhrzeit
    const wt = this.db.data.settings.wasteReminderTime || '19:00';
    const wAt = at(today, wt);
    if (wAt > from && wAt <= now) {
      const tomorrow = ymd(new Date(now + 864e5));
      const list = this.wastePickups(tomorrow, tomorrow);
      if (list.length) {
        const duties = Object.values(this.db.data.calendars).find((c) => c.kind === 'waste' && !c.deleted)?.duties || {};
        const duty = list.map((p) => duties[p.wasteKey]).find(Boolean);
        due.push([`w:${tomorrow}`, { title: `Morgen: ${[...new Set(list.map((p) => p.wasteName))].join(', ')}`, body: duty && this.db.data.members[duty] ? `${this.db.data.members[duty].name} stellt heute Abend raus` : 'Heute Abend rausstellen', tag: 'waste', url: '#abfall' }, null]);
      }
    }
    let n = 0;
    for (const [key, msg, forMembers] of due) {
      for (const [id, s] of subs) {
        if (forMembers?.length && s.memberId && !forMembers.includes(s.memberId)) continue;
        const k = `${key}:${id}`;
        if (sent[k]) continue;
        sent[k] = now; n++;
        await this.send(id, msg);
      }
    }
    for (const [k, ts] of Object.entries(sent)) if (now - ts > 3 * 864e5) delete sent[k];
    if (n) this.db.save();
    return n;
  }
}
