// Nachbildung des Tauri-Rust-Backends im Browser für E2E-Tests der Oberfläche.
// Wird per Playwright addInitScript in die Seite injiziert (Funktion muss eigenständig sein).
// Die echten Rust-Implementierungen sind separat getestet (cargo test, tests/e2e/run-e2e.mjs).

// ------------------------------------------------------------ Tauri-Backend-Nachbildung (läuft im Browser)
export function installMockBackend(cfg) {
  const enc = new TextEncoder();
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  const state = {
    settings: {
      role: cfg.role, defaultMode: "remote", adapter: "mock", setupCompleted: true, displayName: cfg.name, siteId: cfg.siteId,
      signalingUrl: "", usePublicStun: false, extraStun: "", lanPort: 47870, projectFolder: "C:\\Musik\\Sommer-Track Project", activeProjectId: "",
    },
    daw: { isPlaying: false, tempo: 120, loopEnabled: false, linkEnabled: false, log: [],
      tracks: [{ index: 0, name: "Drums", volume: 0.85, panning: 0 }, { index: 1, name: "Bass", volume: 0.85, panning: 0 }, { index: 2, name: "Keys", volume: 0.85, panning: 0 }] },
    projects: new Map(),
    items: new Map(),
    parts: new Map(),
    keep: new Map(),
    received: new Map(),
  };
  window.__mock = state;
  // Datenkanäle für Angriffstests mitschneiden (verändert das Verhalten nicht)
  window.__channels = [];
  const OrigPC = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends OrigPC {
    constructor(...a) {
      super(...a);
      this.addEventListener("datachannel", (e) => window.__channels.push(e.channel));
    }
    createDataChannel(...a) {
      const c = super.createDataChannel(...a);
      window.__channels.push(c);
      return c;
    }
  };
  const status = () => ({ adapter: "mock", connection: "simulated", liveVersion: null, isPlaying: state.daw.isPlaying, tempo: state.daw.tempo,
    loopEnabled: state.daw.loopEnabled, numTracks: state.daw.tracks.length, linkEnabled: state.daw.linkEnabled, queryMs: 0 });
  const wins = (a, b) => a.clock > b.clock || (a.clock === b.clock && a.site > b.site);
  const err = (kind, message) => Promise.reject({ kind, message });
  const handlers = {
    app_info: () => ({ version: "0.2.0", platform: "e2e chromium", dataDir: "(simuliert)", adapter: "mock", adapterError: null, oscSendPort: 11000, oscListenPort: 11001 }),
    settings_get: () => ({ ...state.settings }),
    settings_save: ({ settings }) => (state.settings = { ...settings }),
    daw_status: status,
    daw_tracks: () => state.daw.tracks.map((t) => ({ ...t })),
    daw_probe: () => ({ adapter: "mock", reachable: false, liveVersion: null, roundtripMs: null, message: "Mock" }),
    daw_errors: () => [],
    daw_metrics: () => ({ count: 0, minMs: null, avgMs: null, p95Ms: null, maxMs: null, timeouts: 0, recent: [] }),
    run_diagnostics: () => [],
    daw_execute: ({ command: c }) => {
      state.daw.log.push(c);
      if (c.type === "play" || c.type === "continuePlaying") state.daw.isPlaying = true;
      if (c.type === "stop") state.daw.isPlaying = false;
      if (c.type === "setTempo") state.daw.tempo = c.bpm;
      if (c.type === "setLoop") state.daw.loopEnabled = c.enabled;
      if (c.type === "setLinkEnabled") state.daw.linkEnabled = c.enabled;
      if (c.type === "setTrackVolume") state.daw.tracks[c.track].volume = c.value;
      if (c.type === "setTrackPanning") state.daw.tracks[c.track].panning = c.value;
      return { command: c, adapter: "mock", verified: true, totalMs: 0.2, note: "Mock-Modus" };
    },
    hub_projects: () => [...state.projects.values()],
    hub_project_upsert: ({ project }) => (state.projects.set(project.id, project), project),
    hub_items: ({ projectId }) => [...state.items.values()].filter((i) => i.projectId === projectId),
    hub_merge: ({ projectId, items }) => {
      const applied = [];
      for (const it of items) {
        if (it.projectId !== projectId) return err("hub", "falsches Projekt");
        const cur = state.items.get(it.id);
        if (!cur || wins(it, cur)) {
          state.items.set(it.id, it);
          applied.push(it);
        }
      }
      return applied;
    },
    transfer_info: () => ({ receiveDir: "(simuliert)\\Empfangen", maxBytes: 512 * 1024 * 1024 }),
    transfer_begin: ({ id, name, size, sha256 }) => {
      if (!/\.(wav|aiff?|mp3|flac|midi?)$/i.test(name)) return err("extensionNotAllowed", "Dateityp nicht erlaubt");
      const prev = state.keep.get(sha256) ?? [];
      state.parts.set(id, { name: name.split(/[\\/]/).pop(), size, sha256, chunks: [...prev], len: prev.reduce((a, c) => a + c.length, 0) });
      return { id, fileName: name, resumeOffset: state.parts.get(id).len };
    },
    transfer_write: (data, headers) => {
      const p = state.parts.get(headers["x-transfer-id"]);
      if (!p) return err("unknownTransfer", "unbekannt");
      if (Number(headers["x-offset"]) !== p.len) return err("outOfOrder", "Lücke");
      p.chunks.push(new Uint8Array(data));
      p.len += data.byteLength;
      return p.len;
    },
    transfer_finish: async ({ id }) => {
      const p = state.parts.get(id);
      const all = new Uint8Array(p.len);
      let o = 0;
      for (const c of p.chunks) { all.set(c, o); o += c.length; }
      const sha = hex(await crypto.subtle.digest("SHA-256", all));
      if (sha !== p.sha256) return err("hashMismatch", "Prüfsumme stimmt nicht");
      state.received.set(p.name, { size: p.len, sha256: sha, data: all });
      state.parts.delete(id);
      return { id, fileName: p.name, path: "(simuliert)\\" + p.name, size: p.len, sha256: sha, verified: true };
    },
    transfer_cancel: ({ id, keepPartial }) => {
      const p = state.parts.get(id);
      if (p && keepPartial) state.keep.set(p.sha256, p.chunks);
      state.parts.delete(id);
    },
    transfer_list: () => [...state.received.entries()].map(([fileName, f]) => ({ fileName, size: f.size, modifiedMs: Date.now() })),
    transfer_preview: ({ fileName }) => state.received.get(fileName).data.buffer,
    transfer_import: ({ fileName, projectDir }) => `${projectDir}\\Samples\\Imported\\Connect Studio\\${fileName}`,
    hosting_start: ({ port }) => ({ active: true, port, urls: [cfg.signalUrl] }),
    hosting_stop: () => ({ active: false, port: 0, urls: [] }),
  };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args, options) => {
      const h = handlers[cmd];
      if (!h) throw { kind: "unknown", message: `nicht nachgebildet: ${cmd}` };
      if (cmd === "transfer_write") return h(args, options?.headers ?? {});
      return h(args ?? {});
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
    convertFileSrc: (p) => p,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
  };
  void enc;
}

