#!/usr/bin/env node
// Zwei-Teilnehmer-E2E der Online-Zusammenarbeit.
//
// ECHT:   gebaute Oberfläche (apps/desktop/dist), Signalisierungsserver (lom-signaling,
//         Rust-Binary), WebRTC (Video/Audio/DataChannels) in Chromium – dieselbe Engine
//         wie WebView2 unter Windows –, Sitzungslogik, Hub-Abgleich, Dateiübertragung.
// SIMULIERT: das Tauri-Rust-Backend (DAW = Mock, Hub/Transfer-Speicher im Browser),
//         Kamera/Mikrofon (Chromium-Testgeräte). Rust-Backend und AbletonOSC sind
//         separat getestet (cargo test).
//
// Voraussetzungen: npm run build -w @lom/desktop; cargo build -p lom-signaling
// Screenshots: docs/screenshots/1x-*.png

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Playwright aus dem Projekt oder (falls vorinstalliert) global laden
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require("playwright");
  } catch {
    return require(require.resolve("playwright", { paths: [process.cwd(), ...(process.env.NODE_PATH ?? "").split(":"), "/opt/node-tools/node_modules"] }));
  }
})();

import { installMockBackend } from "./mock-backend.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = join(ROOT, "apps", "desktop", "dist");
const SIGNAL = join(ROOT, "target", "debug", process.platform === "win32" ? "lom-signaling.exe" : "lom-signaling");
const SHOTS = join(ROOT, "docs", "screenshots");
const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? " – " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ Hilfsdienste
function serveDist() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = join(DIST, decodeURIComponent((req.url ?? "/").split("?")[0]) === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
    if (!p.startsWith(DIST) || !existsSync(p)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" }).end(readFileSync(p));
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ srv, url: `http://127.0.0.1:${srv.address().port}/` })));
}

function startSignaling() {
  return new Promise((res, rej) => {
    const p = spawn(SIGNAL, ["--bind", "127.0.0.1:0"], { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", (d) => {
      const m = /ws:\/\/[\d.]+:\d+/.exec(String(d));
      if (m) res({ p, url: m[0] });
    });
    p.on("exit", (c) => rej(new Error("lom-signaling beendet: " + c)));
  });
}

async function shot(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, name) });
  console.log(`  📷 docs/screenshots/${name}`);
}

async function videoPlaying(page, testId) {
  return page.waitForFunction(
    (id) => {
      const v = document.querySelector(`[data-testid="${id}"]`);
      return v && v.videoWidth > 0 && v.readyState >= 2 && !v.paused;
    },
    testId,
    { timeout: 20000 },
  );
}

// ------------------------------------------------------------ Ablauf
async function main() {
  if (!existsSync(join(DIST, "index.html"))) throw new Error("apps/desktop/dist fehlt – npm run build -w @lom/desktop");
  if (!existsSync(SIGNAL)) throw new Error("lom-signaling fehlt – cargo build -p lom-signaling");
  const web = await serveDist();
  const sig = await startSignaling();
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const newPeer = async (role, name, siteId) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera", "microphone"] });
    await ctx.addInitScript(installMockBackend, { role, name, siteId, signalUrl: sig.url });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`  [${name}] Seitenfehler: ${e.message}`));
    await page.goto(web.url);
    return { ctx, page };
  };

  try {
    const { page: host } = await newPeer("host", "Lock", "hostsite01");
    let { ctx: guestCtx, page: guest } = await newPeer("guest", "Mara", "guestsite01");

    // ---------------- Verbindung
    await host.click('[data-testid="nav-session"]');
    await host.fill('[data-testid="host-new-project"]', "Sommer-Track");
    await host.click('[data-testid="btn-host"]');
    const invite = (await host.textContent('[data-testid="invite-code"]')).trim();
    record("Host erzeugt Einladung (LOM1-Code mit Geheimnis)", invite.startsWith("LOM1."));
    await shot(host, "11-session-host-wartet.png");

    await guest.click('[data-testid="nav-session"]');
    await guest.fill('[data-testid="join-code"]', invite);
    const t0 = Date.now();
    await guest.click('[data-testid="btn-join"]');
    await host.waitForSelector('[data-testid="session-phase"][data-phase="connected"]', { timeout: 20000 });
    await guest.waitForSelector('[data-testid="session-phase"][data-phase="connected"]', { timeout: 20000 });
    record("Verbindung über Signalisierungsserver + WebRTC", true, `${Date.now() - t0} ms bis „verbunden“`);

    const codeH = await host.textContent('[data-testid="security-code"] strong', { timeout: 10000 });
    const codeG = await guest.textContent('[data-testid="security-code"] strong', { timeout: 10000 });
    record("Sicherheitscode auf beiden Seiten identisch", codeH === codeG && /^\d{3} \d{3}$/.test(codeH), codeH);

    await videoPlaying(host, "video-remote");
    await videoPlaying(guest, "video-remote");
    const dims = await host.$eval('[data-testid="video-remote"]', (v) => `${v.videoWidth}x${v.videoHeight}`);
    record("Video wird in beide Richtungen übertragen", true, `Host empfängt ${dims}`);
    const audio = await host.$eval('[data-testid="video-remote"]', (v) => v.srcObject.getAudioTracks().length);
    record("Sprache (Audiospur) wird übertragen", audio === 1);
    await sleep(4500); // Messwerte sammeln
    const net = await host.textContent('[data-testid="net-stats"]');
    record("Netzwerkwerte gemessen (RTT, Jitter, Verlust, Bitrate)", /Netzwerk-RTT[\d.]+ ms/.test(net.replace(/\s+/g, "")) || /RTT\s*[\d.]+/.test(net), net.replace(/\s+/g, " ").slice(0, 160));
    await shot(host, "12-session-host-verbunden.png");

    // ---------------- Steuerung
    await guest.click('[data-testid="nav-studio"]');
    await guest.waitForSelector('[data-testid="remote-studio-banner"]');
    await guest.waitForFunction(() => document.querySelector('[data-testid="transport-state"]')?.textContent?.includes("Gestoppt"), null, { timeout: 10000 });
    const lockedPlay = await guest.$eval('[data-testid="btn-play"]', (b) => b.disabled);
    record("Gast ohne Steuerfreigabe kann keine Befehle ausführen (UI gesperrt)", lockedPlay);
    await shot(guest, "13-gast-studio-ohne-freigabe.png");

    await guest.click('[data-testid="nav-session"]');
    await guest.click('[data-testid="btn-request-control"]');
    await host.waitForSelector('[data-testid="control-request"]');
    await shot(host, "14-host-steuerungsanfrage.png");
    await host.click('[data-testid="btn-grant-shared"]');
    await guest.waitForSelector('[data-testid="guest-control"][data-control="shared"]');
    record("Steuerung angefragt und vom Host gemeinsam freigegeben", true);

    await guest.click('[data-testid="nav-studio"]');
    await guest.waitForFunction(() => !document.querySelector('[data-testid="btn-play"]').disabled);
    await guest.click('[data-testid="btn-play"]');
    await host.waitForFunction(() => window.__mock.daw.isPlaying === true, null, { timeout: 5000 });
    await guest.waitForFunction(() => document.querySelector('[data-testid="transport-state"]')?.textContent?.includes("Läuft"), null, { timeout: 5000 });
    record("Gast startet Play in der Host-DAW", true);
    await guest.fill('[data-testid="tempo-input"]', "126");
    await guest.click('[data-testid="btn-set-tempo"]');
    await host.waitForFunction(() => window.__mock.daw.tempo === 126, null, { timeout: 5000 });
    record("Gast setzt Tempo 126 in der Host-DAW", true);
    await guest.waitForFunction(() => document.querySelector('[data-testid="tempo-value"]')?.textContent?.startsWith("126.00"), null, { timeout: 5000 });
    await shot(guest, "15-gast-steuert-host-daw.png");

    // komplett übergeben + zurückholen
    await host.click('[data-testid="control-guest"]');
    await guest.waitForSelector('[data-testid="guest-control"][data-control="guest"]', { state: "attached" }).catch(() => {});
    await host.click('[data-testid="nav-studio"]');
    await host.waitForSelector('[data-testid="studio-locked"]');
    const hostLocked = await host.$eval('[data-testid="btn-play"]', (b) => b.disabled);
    record("Steuerung komplett übergeben → Host lokal gesperrt", hostLocked);
    await shot(host, "16-host-steuerung-uebergeben.png");
    await host.click('[data-testid="studio-reclaim"]');
    await guest.waitForFunction(() => document.querySelector('[data-testid="btn-play"]')?.disabled === true, null, { timeout: 5000 });
    const before = await host.evaluate(() => window.__mock.daw.log.length);
    record("Widerruf wirkt sofort – Gast wieder gesperrt", true);
    // Angriff: Gast sendet trotz Sperre eine rohe Steuernachricht direkt über den DataChannel
    const reply = await guest.evaluate(async () => {
      const ch = window.__channels.find((c) => c.label === "control" && c.readyState === "open");
      return new Promise((resolve) => {
        const onMsg = (e) => {
          const m = JSON.parse(e.data);
          if (m.t === "daw-result" && m.id === "bypass01") {
            ch.removeEventListener("message", onMsg);
            resolve(m);
          }
        };
        ch.addEventListener("message", onMsg);
        ch.send(JSON.stringify({ t: "daw-cmd", id: "bypass01", command: { type: "stop" } }));
        setTimeout(() => resolve(null), 3000);
      });
    });
    const after = await host.evaluate(() => window.__mock.daw.log.length);
    const stillPlaying = await host.evaluate(() => window.__mock.daw.isPlaying);
    record("Roher DataChannel-Befehl ohne Freigabe wird vom Host abgelehnt", reply?.ok === false && after === before && stillPlaying, reply?.error ?? "keine Antwort");

    // ---------------- Hub
    await guest.click('[data-testid="nav-hub"]');
    await guest.waitForSelector('[data-testid="hub-project"]');
    const proj = await guest.textContent('[data-testid="hub-project"]');
    record("Gast übernimmt das Hub-Projekt des Hosts", proj.includes("Sommer-Track"));
    await guest.fill('[data-testid="hub-quick"]', "Hook in A-Moll – Vocal-Chop ab Takt 33");
    await guest.click('[data-testid="btn-hub-add"]');
    await host.click('[data-testid="nav-hub"]');
    await host.waitForSelector('[data-testid="hub-card"][data-title^="Hook in A-Moll"]', { timeout: 5000 });
    record("Idee des Gastes erscheint sofort beim Host", true);
    await host.click('[data-testid="btn-hub-template"]');
    await guest.waitForFunction(() => document.querySelectorAll('[data-column="todo"] [data-testid="hub-card"]').length === 10, null, { timeout: 5000 });
    record("Planer-Vorlage „Track fertigstellen“ beim Partner synchron (10 Aufgaben)", true);
    await host.click('[data-column="todo"] [data-testid="hub-card"] [data-testid="hub-card-next"]');
    await guest.waitForFunction(() => document.querySelectorAll('[data-column="doing"] [data-testid="hub-card"]').length === 1, null, { timeout: 5000 });
    record("Statusänderung im Planer wird abgeglichen", true);
    await shot(guest, "17-hub-planer.png");

    // ---------------- Samples per Drag & Drop
    const size = 3 * 1024 * 1024 + 123;
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >> 9)) & 0xff;
    bytes.write("RIFF", 0);
    const sha = createHash("sha256").update(bytes).digest("hex");
    await guest.click('[data-testid="nav-samples"]');
    await guest.evaluate(async ({ b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bin], "Vocal Chop 126bpm.wav", { type: "audio/wav" }));
      dt.items.add(new File([new Uint8Array([77, 90])], "tool.exe"));
      const zone = document.querySelector('[data-testid="dropzone"]');
      zone.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, { b64: bytes.toString("base64") });
    const rejected = await guest.waitForSelector("text=tool.exe", { timeout: 5000 }).then(() => true).catch(() => false);
    record("Nicht erlaubter Dateityp (.exe) wird abgewiesen", rejected);
    await host.click('[data-testid="nav-samples"]');
    await host.waitForSelector('[data-testid="transfer"][data-status="incoming"]', { timeout: 10000 });
    await host.click('[data-testid="btn-accept"]');
    const tStart = Date.now();
    await host.waitForSelector('[data-testid="transfer"][data-status="done"]', { timeout: 30000 });
    await guest.waitForSelector('[data-testid="transfer"][data-status="done"]', { timeout: 10000 });
    const got = await host.evaluate(() => {
      const f = window.__mock.received.get("Vocal Chop 126bpm.wav");
      return f ? { size: f.size, sha256: f.sha256 } : null;
    });
    record("Sample per Drag & Drop übertragen, SHA-256 identisch", got?.sha256 === sha && got?.size === size, `${(size / 1024 / 1024).toFixed(1)} MB in ${Date.now() - tStart} ms, ${sha.slice(0, 12)}…`);
    await host.waitForSelector('[data-testid="received"] >> text=Vocal Chop 126bpm.wav');
    await shot(host, "18-samples-empfangen.png");

    // ---------------- Verbindungsabbruch
    await host.click('[data-testid="control-shared"]').catch(() => {});
    await host.click('[data-testid="nav-session"]');
    await host.click('[data-testid="control-shared"]');
    await guest.close();
    await guestCtx.close();
    await host.waitForSelector('[data-testid="session-phase"][data-phase="reconnecting"]', { timeout: 15000 });
    const ctl = await host.$eval('[data-testid="control-host"]', (r) => r.checked);
    record("Verbindungsabbruch → Steuerfreigabe sofort aufgehoben (sicherer Zustand)", ctl);

    // ---------------- Wiederverbindung
    ({ ctx: guestCtx, page: guest } = await newPeer("guest", "Mara", "guestsite01"));
    await guest.click('[data-testid="nav-session"]');
    await guest.fill('[data-testid="join-code"]', invite);
    await guest.click('[data-testid="btn-join"]');
    await host.waitForSelector('[data-testid="session-phase"][data-phase="connected"]', { timeout: 20000 });
    await guest.click('[data-testid="nav-hub"]');
    await guest.waitForFunction(() => document.querySelectorAll('[data-testid="hub-card"]').length === 11, null, { timeout: 10000 });
    record("Wiederverbindung mit derselben Einladung; Hub-Stand vollständig neu abgeglichen", true);
    await guest.click('[data-testid="nav-studio"]');
    const relocked = await guest.$eval('[data-testid="btn-play"]', (b) => b.disabled);
    record("Nach Wiederverbindung keine automatische Steuerfreigabe", relocked);
    await guestCtx.close();
  } finally {
    await browser.close();
    sig.p.kill();
    web.srv.close();
  }
}

main()
  .catch((e) => record("Collab-E2E-Lauf", false, e.message.split("\n")[0]))
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} Collab-E2E-Prüfungen bestanden`);
    writeFileSync(join(ROOT, "tests", "e2e", "last-collab-run.json"), JSON.stringify({ at: new Date().toISOString(), engine: "chromium (Playwright)", results }, null, 2));
    process.exit(failed.length ? 1 : 0);
  });
