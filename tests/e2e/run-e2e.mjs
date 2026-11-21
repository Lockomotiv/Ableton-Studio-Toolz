#!/usr/bin/env node
// End-to-End-Test der GEBAUTEN Desktop-App über tauri-driver (WebDriver).
//
// Ablauf in einer App-Sitzung:
//   A  Start ohne Ableton im Mock-Modus (frisches Datenverzeichnis)
//   B  Umschalten auf AbletonOSC, ohne dass AbletonOSC läuft → "Nicht verbunden"
//   C  AbletonOSC-Gegenstelle (echter AbletonOSC-Code, gestubbte Live-API) startet
//      → "Verbunden", Play/Stop/Tempo wirken nachweislich in der Gegenstelle
//   D  Gegenstelle wird beendet → "Nicht verbunden", Bedienelemente gesperrt
//
// Voraussetzungen: `npx tauri build --debug --no-bundle` (apps/desktop),
// tauri-driver (cargo install tauri-driver --locked), unter Linux WebKitWebDriver
// (+ Xvfb ohne Bildschirm), unter Windows msedgedriver. Python 3 und
// scripts/fetch-abletonosc.(sh|ps1).
//
// Screenshots: docs/screenshots/*.png (echte Aufnahmen der laufenden App).

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSocket } from "node:dgram";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WIN = process.platform === "win32";
const APP = process.env.LOM_APP ?? join(ROOT, "target", "debug", WIN ? "connect-studio.exe" : "connect-studio");
const SHOTS = join(ROOT, "docs", "screenshots");
const DRIVER = "http://127.0.0.1:4444";
const PY = process.env.PYTHON ?? (WIN ? "python" : "python3");

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? " – " + detail : ""}`);
}

async function freePort() {
  return new Promise((res) => {
    const s = createSocket("udp4");
    s.bind(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 8000, step = 150) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(step);
  }
  throw new Error(`Timeout beim Warten (${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

// ------------------------------------------------------------ Mini-WebDriver-Client
const EL = "element-6066-11e4-a52e-4f735466cecf";
let sid;
async function wd(method, path, body) {
  const r = await fetch(`${DRIVER}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok || (j.value && j.value.error)) throw new Error(`${method} ${path}: ${JSON.stringify(j.value)}`);
  return j.value;
}
const s = (p) => `/session/${sid}${p}`;
const find = async (css) => (await wd("POST", s("/element"), { using: "css selector", value: css }))[EL];
const click = async (css) => wd("POST", s(`/element/${await find(css)}/click`), {});
const text = async (css) => wd("GET", s(`/element/${await find(css)}/text`));
const attr = async (css, a) => wd("GET", s(`/element/${await find(css)}/attribute/${a}`));
const exists = async (css) => {
  try {
    await find(css);
    return true;
  } catch {
    return false;
  }
};
async function type(css, value) {
  const id = await find(css);
  await wd("POST", s(`/element/${id}/clear`), {});
  await wd("POST", s(`/element/${id}/value`), { text: value });
}
async function screenshot(name) {
  const b64 = await wd("GET", s("/screenshot"));
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, name), Buffer.from(b64, "base64"));
  console.log(`  📷 docs/screenshots/${name}`);
}
const badge = () => attr('[data-testid="connection-badge"]', "data-state");

// ------------------------------------------------------------ Prozesse
const procs = [];
function start(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  procs.push(p);
  return p;
}
function stopAll() {
  for (const p of procs) if (p.exitCode === null) p.kill();
}
process.on("exit", stopAll);
process.on("SIGINT", () => process.exit(130));

function startHarness(listen, response) {
  const dir = join(ROOT, "tests", "integration", "abletonosc-harness");
  const events = [];
  const p = start(PY, ["-u", join(dir, "harness.py"), "--abletonosc", join(dir, "vendor", "AbletonOSC"),
    "--listen-port", String(listen), "--response-port", String(response)]);
  let buf = "";
  p.stdout.on("data", (d) => {
    buf += d;
    const lines = buf.split("\n");
    buf = lines.pop();
    events.push(...lines);
  });
  return { p, events, ready: () => waitFor(() => events.some((l) => l.startsWith("HARNESS READY")), 10000) };
}

// ------------------------------------------------------------ Ablauf
async function main() {
  if (!existsSync(APP)) throw new Error(`App nicht gefunden: ${APP} – zuerst "npx tauri build --debug --no-bundle" ausführen`);
  const listen = await freePort();
  const response = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), "lom-e2e-"));
  const env = { ...process.env, LOM_DATA_DIR: dataDir, LOM_OSC_SEND_PORT: String(listen), LOM_OSC_LISTEN_PORT: String(response) };

  const driverArgs = (process.env.TAURI_DRIVER_ARGS ?? "").split(" ").filter(Boolean);
  const driver = start(process.env.TAURI_DRIVER ?? "tauri-driver", driverArgs, { env });
  driver.stderr.on("data", (d) => process.env.E2E_DEBUG && process.stderr.write(d));
  await waitFor(async () => (await fetch(`${DRIVER}/status`)).ok, 15000).catch(() => {
    throw new Error("tauri-driver nicht erreichbar");
  });

  const session = await wd("POST", "/session", {
    capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: APP } } },
  });
  sid = session.sessionId;

  // ---------------- A: Mock-Modus ohne Ableton
  await waitFor(() => exists('[data-testid="connection-badge"]'));
  const setupShown = await waitFor(() => exists('[data-testid="wizard-step-1"]'), 5000).catch(() => false);
  record("Erststart öffnet Einrichtungsassistenten", !!setupShown);
  await screenshot("01-einrichtung-erststart.png");

  await click('[data-testid="nav-studio"]');
  await waitFor(async () => (await badge()) === "mock");
  record("Client startet ohne Ableton im Mock-Modus", true, "Badge data-state=mock");
  record("Mock-Hinweis sichtbar", await exists('[data-testid="mock-banner"]'));
  await click('[data-testid="btn-play"]');
  await waitFor(async () => (await text('[data-testid="transport-state"]')).includes("Läuft"));
  record("Mock: Play setzt Transport auf 'Läuft'", true);
  await screenshot("02-studio-mock.png");
  await click('[data-testid="btn-stop"]');
  await waitFor(async () => (await text('[data-testid="transport-state"]')).includes("Gestoppt"));
  record("Mock: Stop setzt Transport auf 'Gestoppt'", true);

  await click('[data-testid="nav-diagnostics"]');
  await waitFor(async () => (await attr('[data-check="osc_roundtrip"]', "data-status")) === "skipped");
  record("Diagnose im Mock-Modus meldet keine Ableton-Verbindung", true, "osc_roundtrip=skipped");

  // ---------------- B: AbletonOSC gewählt, aber nicht erreichbar
  await click('[data-testid="nav-settings"]');
  await click('[data-testid="adapter-osc"]');
  await waitFor(async () => (await badge()) === "disconnected", 10000);
  record("AbletonOSC ohne Gegenstelle → 'Nicht verbunden' (kein vorgetäuschter Status)", true);
  await click('[data-testid="nav-studio"]');
  await waitFor(() => exists('[data-testid="status-error"]'));
  record("Bedienelemente ohne Verbindung gesperrt", (await attr('[data-testid="btn-play"]', "disabled")) !== null);
  await screenshot("03-studio-nicht-verbunden.png");

  // ---------------- C: Gegenstelle mit echtem AbletonOSC-Code
  const h = startHarness(listen, response);
  await h.ready();
  await waitFor(async () => (await badge()) === "connected", 10000);
  record("AbletonOSC-Verbindung wird erkannt", true, `Badge: ${await text('[data-testid="connection-badge"]')}`.replace(/\n/g, " "));

  await waitFor(async () => (await attr('[data-testid="btn-play"]', "disabled")) === null);
  await click('[data-testid="btn-play"]');
  await waitFor(() => h.events.some((l) => l.includes('"prop": "is_playing", "value": true')));
  await waitFor(async () => (await text('[data-testid="transport-state"]')).includes("Läuft"));
  record("Play wird über AbletonOSC ausgeführt (Gegenstelle bestätigt is_playing=true)", true);

  await type('[data-testid="tempo-input"]', "128");
  await click('[data-testid="btn-set-tempo"]');
  await waitFor(() => h.events.some((l) => l.includes('"prop": "tempo", "value": 128.0')));
  await waitFor(async () => (await text('[data-testid="tempo-value"]')).startsWith("128.00"));
  record("Tempo 128 BPM wird gesetzt und zurückgelesen", true);
  await waitFor(async () => (await text('[data-testid="tracks-table"]')).includes("Harness Track 4"));
  await sleep(300);
  await screenshot("04-studio-abletonosc.png");

  await click('[data-testid="btn-stop"]');
  await waitFor(() => h.events.some((l) => l.includes('"prop": "is_playing", "value": false')));
  await waitFor(async () => (await text('[data-testid="transport-state"]')).includes("Gestoppt"));
  record("Stop wird über AbletonOSC ausgeführt (Gegenstelle bestätigt is_playing=false)", true);
  const log = await text('[data-testid="command-log"]');
  record("Befehlsprotokoll zeigt verifizierte Befehle", (log.match(/✔/g) ?? []).length >= 3, log.split("\n")[0]);

  await click('[data-testid="nav-diagnostics"]');
  await waitFor(async () => (await attr('[data-check="osc_roundtrip"]', "data-status")) === "pass", 10000);
  const api = await attr('[data-check="osc_api"]', "data-status");
  record("Diagnose: /live/test und API-Kompatibilität bestanden", api === "pass", `osc_api=${api}`);
  await waitFor(() => exists('[data-testid="metrics-table"]'));
  await screenshot("05-diagnose-abletonosc.png");

  // ---------------- D: Verbindungsabbruch
  h.p.kill();
  await click('[data-testid="nav-studio"]');
  await waitFor(async () => (await badge()) === "disconnected", 10000);
  const disabled = (await attr('[data-testid="btn-play"]', "disabled")) !== null;
  record("Verbindungsabbruch → 'Nicht verbunden', Steuerung gesperrt", disabled);

  await wd("DELETE", s(""));
}

main()
  .catch((e) => {
    record("E2E-Lauf", false, e.message);
  })
  .finally(async () => {
    stopAll();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} E2E-Prüfungen bestanden`);
    writeFileSync(join(ROOT, "tests", "e2e", "last-run.json"), JSON.stringify({ at: new Date().toISOString(), platform: process.platform, results }, null, 2));
    process.exit(failed.length ? 1 : 0);
  });
