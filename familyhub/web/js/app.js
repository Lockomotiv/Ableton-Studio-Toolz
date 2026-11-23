// FamilyHub 3 – App-Rahmen: Navigation, Routing, Theme, Zurück-Taste.
import { h, icon, closeTopSheet, sheet, fill } from './ui.js';
import { store } from './store.js';
import { childMode, refreshNative, members } from './domain.js';
import { viewToday, viewCalendar, viewTasks, viewShopping, hubPage, TASK_TABS, KITCHEN_TABS } from './views.js';
import { viewChores, viewRoutines, viewRewards } from './household.js';
import { viewMeals, viewRecipes } from './kitchen.js';
import { openWall, closeWall, wallActive, armScreensaver } from './wall.js';
import { refreshAll as refreshCalendars } from './extcal.js';
import { viewMore, viewFamily, viewChild, viewPhotos, viewPi, viewSync, viewSettings, viewHelp, exitChildMode, viewExternal } from './more.js';
import { openCapture } from './capture.js';
import { consumeLaunchAction, haptic, moveToBack, isApp } from './native.js';
import { voiceAvailable } from './voice.js';
import { editMember } from './editors.js';

const ROUTES = {
  heute: viewToday, kalender: viewCalendar, aufgaben: viewTasks, einkauf: viewShopping, mehr: viewMore,
  aemter: () => hubPage('Aufgaben', TASK_TABS, 'aemter', viewChores()),
  routinen: () => hubPage('Aufgaben', TASK_TABS, 'routinen', viewRoutines()),
  sterne: () => hubPage('Aufgaben', TASK_TABS, 'sterne', viewRewards()),
  essen: () => hubPage('Essen', KITCHEN_TABS, 'essen', viewMeals()),
  rezepte: () => hubPage('Rezepte', KITCHEN_TABS, 'rezepte', viewRecipes()),
  familie: viewFamily, kinder: viewChild, extern: viewExternal, fotos: viewPhotos, pi: viewPi, sync: viewSync, einstellungen: viewSettings, hilfe: viewHelp,
};
const CHILD_ROUTES = new Set(['heute', 'kalender', 'aufgaben', 'aemter', 'routinen', 'sterne', 'hilfe']);
const TABS = [['heute', 'Heute', 'home'], ['kalender', 'Kalender', 'calendar'], ['aufgaben', 'Aufgaben', 'tasks'], ['einkauf', 'Einkauf', 'cart'], ['mehr', 'Mehr', 'menu']];
const PARENT = { extern: 'mehr', aemter: 'aufgaben', routinen: 'aufgaben', sterne: 'aufgaben', essen: 'einkauf', rezepte: 'einkauf', familie: 'mehr', kinder: 'mehr', fotos: 'mehr', pi: 'mehr', sync: 'mehr', einstellungen: 'mehr', hilfe: 'mehr' };

const app = document.getElementById('app');
const view = h('main', { id: 'view', tabindex: -1 });
const nav = h('nav.tabbar', { 'aria-label': 'Hauptnavigation' });
const topbar = h('header.topbar');
const fab = h('button.fab', { 'aria-label': 'Neuer Eintrag per Sprache' }, icon('mic', 28));
let pressTimer = null; let longPressed = false;
fab.addEventListener('pointerdown', () => { longPressed = false; pressTimer = setTimeout(() => { longPressed = true; haptic(); openCapture({ mode: 'text' }); }, 450); });
fab.addEventListener('pointerup', () => clearTimeout(pressTimer));
fab.addEventListener('pointerleave', () => clearTimeout(pressTimer));
fab.addEventListener('click', () => { if (!longPressed) openCapture({ mode: voiceAvailable() ? 'voice' : 'text' }); });
fab.addEventListener('contextmenu', (e) => e.preventDefault());

app.append(topbar, view, fab, nav);

function route() {
  let r = (location.hash || '#heute').slice(1) || 'heute';
  if (!ROUTES[r]) r = 'heute';
  if (childMode() && !CHILD_ROUTES.has(r)) r = 'heute';
  return r;
}

let lastRoute = null;
function render(reason) {
  const r = route();
  const kid = childMode();
  document.body.classList.toggle('child', !!kid);
  // Topbar
  const syncState = store.serverEnabled() ? store.sync.state : 'local';
  fill(topbar,
    h('div.brand', null, h('span.logo', null, '⌂'), h('span', null, kid ? `${kid.name}s Bereich` : store.config.familyName || 'FamilyHub')),
    h('span.spacer'),
    store.serverEnabled() ? h('a.sync-dot.' + syncState, { href: kid ? null : '#sync', title: syncState === 'error' ? store.sync.error : 'Synchronisiert', 'aria-label': 'Synchronisierung' }, icon(syncState === 'error' ? 'cloudOff' : 'sync', 18)) : null,
    h('button.icon-btn', { 'aria-label': 'Wandansicht', title: 'Wandansicht / Bilderrahmen', onclick: () => openWall() }, icon('photo', 20)),
    kid ? h('button.btn.small.tonal', { onclick: exitChildMode }, icon('lock', 16), 'Eltern') : null,
  );
  // Tabs
  const active = PARENT[r] || r;
  nav.replaceChildren(...TABS.filter(([k]) => !kid || CHILD_ROUTES.has(k)).map(([k, label, ic]) => h('a.tab' + (active === k ? '.on' : ''), { href: '#' + k, 'aria-current': active === k ? 'page' : null, onclick: () => haptic() }, icon(ic, 24), h('span', null, label))));
  // Inhalt
  const scroll = r === lastRoute ? view.scrollTop : 0;
  const page = ROUTES[r]();
  view.replaceChildren(page);
  if (r === lastRoute && reason) view.scrollTop = scroll; else view.scrollTop = 0;
  if (r !== lastRoute) view.focus({ preventScroll: true });
  lastRoute = r;
}

// Bei Datenänderungen neu zeichnen, aber nicht während getippt wird.
let pending = false;
store.on((reason) => {
  if (reason === 'sync' && route() !== 'sync') { renderTopOnly(); return; }
  if (document.activeElement && view.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { pending = true; return; }
  queueRender(reason);
  if (reason === 'data') refreshNative();
});
document.addEventListener('focusout', () => { if (pending) { pending = false; setTimeout(() => queueRender('data'), 50); } });
let raf = 0;
function queueRender(reason) { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { applyTheme(); render(reason); }); }
function renderTopOnly() { const dot = topbar.querySelector('.sync-dot'); if (dot) dot.className = 'sync-dot ' + store.sync.state; }

window.addEventListener('hashchange', () => render());

function applyTheme() {
  const t = store.config.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}

// Android-Zurück-Taste
window.fhBack = () => {
  if (wallActive()) { closeWall(); return true; }
  if (closeTopSheet()) return true;
  const r = route();
  if (PARENT[r]) { location.hash = PARENT[r]; return true; }
  if (r !== 'heute') { location.hash = 'heute'; return true; }
  return false;
};
window.fhLaunch = (action) => handleLaunch(action);
function handleLaunch(action) {
  if (action === 'voice') openCapture({ mode: 'voice' });
  else if (action === 'add') openCapture({ mode: 'text' });
  else if (action === 'wand') openWall();
  else if (action && ROUTES[action]) location.hash = action;
}

window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTopSheet(); });

// Uhrzeit-abhängige Ansichten (z. B. „Als Nächstes“) jede Minute aktualisieren
setInterval(() => { if (!document.hidden && !document.querySelector('.sheet-wrap') && !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) render('tick'); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render('tick'); refreshNative(); } });

function onboarding() {
  if (store.config.onboarded || members().length || store.list('events').length) return;
  sheet((s) => h('div.sheet-body.welcome', null,
    h('div.welcome-logo', null, '⌂'),
    h('h2.sheet-title', null, 'Willkommen bei FamilyHub'),
    h('p.muted', null, 'Termine, Aufgaben und Einkäufe der ganzen Familie – an einem Ort. Einfach sagen, was ansteht.'),
    h('div.steps', null,
      h('div.step', null, h('b', null, '1'), h('span', null, 'Familie anlegen – damit „mit Lena“ verstanden wird')),
      h('div.step', null, h('b', null, '2'), h('span', null, 'Optional: mit dem Pi verbinden – alle sehen das Gleiche')),
      h('div.step', null, h('b', null, '3'), h('span', null, 'Auf das Mikrofon tippen und lossprechen'))),
    h('div.btn-col', null,
      h('button.btn.primary.big', { onclick: () => { s.close(); editMember(null); } }, icon('users', 18), 'Familie anlegen'),
      h('button.btn.tonal', { onclick: () => { s.close(); location.hash = 'sync'; } }, icon('link', 18), 'Mit Pi verbinden'),
      h('button.btn.ghost', { onclick: () => s.close() }, 'Später'))), { onClose: () => store.saveConfig({ onboarded: true }), label: 'Willkommen' });
}

applyTheme();
render();
refreshNative();
store.syncNow();
setTimeout(onboarding, 400);
armScreensaver();
store.on((r) => { if (r === 'config') armScreensaver(); if (r === 'data' && store.list('calendars').length) refreshCalendars(); });
const la = consumeLaunchAction();
if (la) setTimeout(() => handleLaunch(la), 300);
if (!isApp && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
