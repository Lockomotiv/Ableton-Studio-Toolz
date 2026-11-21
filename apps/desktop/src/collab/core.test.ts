// Zwei SessionCore-Instanzen (Host + Gast), verbunden über eine In-Memory-Leitung,
// die jede Nachricht wie der echte DataChannel serialisiert und prüft.
import { describe, expect, it } from "vitest";
import type { CommandOutcome, DawCommand, LiveStatus, TrackInfo } from "@lom/shared-types";
import { createItem, mergeItems, parseSessionMessage, sha256Hex, type HubItem, type HubProject, type SessionMessage } from "@lom/protocol";
import { SessionCore, type HubBackend, type LocalDaw } from "./core";
import { FileTransfers, type TransferSink } from "./files";

class FakeDaw implements LocalDaw {
  playing = false;
  tempo = 120;
  log: DawCommand[] = [];
  async execute(c: DawCommand): Promise<CommandOutcome> {
    this.log.push(c);
    if (c.type === "play") this.playing = true;
    if (c.type === "stop") this.playing = false;
    if (c.type === "setTempo") this.tempo = c.bpm;
    return { command: c, adapter: "mock", verified: true, totalMs: 1, note: null };
  }
  async status(): Promise<LiveStatus> {
    return { adapter: "mock", connection: "simulated", liveVersion: null, isPlaying: this.playing, tempo: this.tempo, loopEnabled: false, numTracks: 1, linkEnabled: false, queryMs: 0 };
  }
  async tracks(): Promise<TrackInfo[]> {
    return [{ index: 0, name: "Drums", volume: 0.85, panning: 0 }];
  }
}

class MemHub implements HubBackend {
  projects = new Map<string, HubProject>();
  items = new Map<string, HubItem>();
  async ensureProject(p: HubProject) {
    this.projects.set(p.id, p);
  }
  async list(pid: string) {
    return [...this.items.values()].filter((i) => i.projectId === pid);
  }
  async merge(_pid: string, items: HubItem[]) {
    const r = mergeItems(this.items, items);
    this.items = r.next;
    return r.applied;
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const PROJECT: HubProject = { id: "proj1", name: "Sommer-Track", createdMs: 1 };

function pair(mode: "remote" | "dual" = "remote") {
  const daws = { host: new FakeDaw(), guest: new FakeDaw() };
  const hubs = { host: new MemHub(), guest: new MemHub() };
  const wires: { host: ((m: SessionMessage) => void) | null; guest: ((m: SessionMessage) => void) | null } = { host: null, guest: null };
  let open = true;
  const transmit = (to: "host" | "guest") => (m: SessionMessage) => {
    if (!open) return;
    const parsed = parseSessionMessage(JSON.stringify(m));
    if (!parsed) throw new Error("ungültige Nachricht: " + JSON.stringify(m));
    queueMicrotask(() => wires[to]?.(parsed));
  };
  const host = new SessionCore({ role: "host", mode, name: "Lock", siteId: "hostsite", appVersion: "0.2.0", project: PROJECT, daw: daws.host, hub: hubs.host, send: transmit("guest") });
  const guest = new SessionCore({ role: "guest", mode, name: "Gast", siteId: "guestsite", appVersion: "0.2.0", project: null, daw: daws.guest, hub: hubs.guest, send: transmit("host") });
  wires.host = (m) => void host.handle(m);
  wires.guest = (m) => void guest.handle(m);
  return {
    host, guest, daws, hubs,
    connect: async () => {
      open = true;
      host.connected();
      guest.connected();
      for (let i = 0; i < 10; i++) await flush();
    },
    cut: () => {
      open = false;
      host.peerLost("Netzwerk");
      guest.peerLost("Netzwerk");
    },
  };
}

describe("Steuerfreigabe (Remote Studio)", () => {
  it("Gast ohne Freigabe kann keine Befehle ausführen", async () => {
    const p = pair();
    await p.connect();
    await expect(p.guest.executeRemote({ type: "play" })).rejects.toThrow(/Steuerfreigabe/);
    expect(p.daws.host.log).toHaveLength(0);
  });

  it("Host lehnt auch direkt gesendete Befehle ohne Freigabe ab", async () => {
    const p = pair();
    await p.connect();
    // Gast umgeht seine eigene UI-Sperre und sendet direkt
    const sent: SessionMessage[] = [];
    const hostCore = p.host as unknown as { o: { send: (m: SessionMessage) => void } };
    const orig = hostCore.o.send;
    hostCore.o.send = (m) => {
      sent.push(m);
      orig(m);
    };
    await p.host.handle({ t: "daw-cmd", id: "evil1", command: { type: "play" } });
    expect(p.daws.host.log).toHaveLength(0);
    expect(sent.find((m) => m.t === "daw-result")).toMatchObject({ ok: false });
  });

  it("Anfrage → Freigabe → Gast steuert → Widerruf wirkt sofort", async () => {
    const p = pair();
    await p.connect();
    p.guest.requestControl();
    await flush();
    await flush();
    expect(p.host.state.controlRequested).toBe(true);
    p.host.answerRequest(true, "shared");
    await flush();
    await flush();
    expect(p.guest.state.control).toBe("shared");

    const o = await p.guest.executeRemote({ type: "play" });
    expect(o.verified).toBe(true);
    expect(p.daws.host.playing).toBe(true);
    expect(p.host.hostMayControl).toBe(true);

    p.host.setControl("host"); // Widerruf
    // Ein Befehl, der den Host nach dem Widerruf erreicht, wird abgelehnt
    await p.host.handle({ t: "daw-cmd", id: "late1", command: { type: "stop" } });
    expect(p.daws.host.playing).toBe(true);
    await flush();
    await flush();
    await expect(p.guest.executeRemote({ type: "stop" })).rejects.toThrow(/Steuerfreigabe/);
  });

  it("Steuerung komplett übergeben sperrt den Host lokal, Zurückholen jederzeit", async () => {
    const p = pair();
    await p.connect();
    p.host.setControl("guest");
    await flush();
    await flush();
    expect(p.host.hostMayControl).toBe(false);
    expect(p.guest.state.control).toBe("guest");
    await p.guest.executeRemote({ type: "setTempo", bpm: 128 });
    expect(p.daws.host.tempo).toBe(128);
    p.guest.releaseControl();
    for (let i = 0; i < 4; i++) await flush();
    expect(p.host.state.control).toBe("host");
    expect(p.host.hostMayControl).toBe(true);
  });

  it("Verbindungsabbruch hebt die Freigabe sofort auf und bricht offene Befehle ab", async () => {
    const p = pair();
    await p.connect();
    p.host.setControl("guest");
    await flush();
    await flush();
    const pending = p.guest.executeRemote({ type: "play" });
    p.cut();
    await expect(pending).rejects.toThrow(/unterbrochen/);
    expect(p.host.state.control).toBe("host");
    expect(p.guest.state.control).toBe("host");
    expect(p.host.guestMayControl).toBe(false);
    expect(p.guest.state.phase).toBe("reconnecting");
  });

  it("Host überträgt den Live-Status an den Gast", async () => {
    const p = pair();
    await p.connect();
    p.daws.host.playing = true;
    await p.host.tick();
    await flush();
    expect(p.guest.state.remoteStatus?.isPlaying).toBe(true);
    expect(p.guest.state.remoteTracks[0].name).toBe("Drums");
  });

  it("misst die Roundtrip-Zeit des Steuerkanals", async () => {
    const p = pair();
    await p.connect();
    await p.host.tick();
    await p.host.tick();
    for (let i = 0; i < 4; i++) await flush();
    expect(p.host.state.controlRttMs).not.toBeNull();
  });
});

describe("Dual Studio", () => {
  it("koppelt Transport nur mit Zustimmung beider Seiten und ohne Projektänderungen", async () => {
    const p = pair("dual");
    await p.connect();
    p.host.afterLocalCommand({ type: "play" });
    p.host.afterLocalCommand({ type: "setTrackVolume", track: 0, value: 0.1 }); // wird nicht gespiegelt
    for (let i = 0; i < 4; i++) await flush();
    expect(p.daws.guest.log.map((c) => c.type)).toEqual(["play"]);

    p.guest.setTransportLink(false);
    p.host.afterLocalCommand({ type: "stop" });
    for (let i = 0; i < 4; i++) await flush();
    expect(p.daws.guest.log.map((c) => c.type)).toEqual(["play"]);

    // Im Dual-Modus gibt es keine Fernsteuerung der anderen DAW
    await p.host.handle({ t: "daw-cmd", id: "x1", command: { type: "play" } });
    expect(p.daws.host.log).toHaveLength(0);
  });
});

describe("Hub-Abgleich in der Sitzung", () => {
  it("Gast übernimmt das Projekt, Offline-Ideen beider Seiten werden zusammengeführt", async () => {
    const p = pair();
    const hostIdea = createItem({ projectId: PROJECT.id, kind: "note", title: "Hook in A-Moll" }, { author: "Lock", site: "hostsite", clock: 0 });
    await p.hubs.host.merge(PROJECT.id, [hostIdea]);
    const guestTask = createItem({ projectId: PROJECT.id, kind: "task", title: "Bass aufnehmen" }, { author: "Gast", site: "guestsite", clock: 0 });
    await p.hubs.guest.merge(PROJECT.id, [guestTask]); // vorher offline erfasst
    await p.connect();
    expect(p.guest.state.project?.id).toBe(PROJECT.id);
    expect(p.hubs.guest.projects.get(PROJECT.id)?.name).toBe("Sommer-Track");
    expect((await p.hubs.host.list(PROJECT.id)).map((i) => i.title).sort()).toEqual(["Bass aufnehmen", "Hook in A-Moll"]);
    expect((await p.hubs.guest.list(PROJECT.id)).map((i) => i.title).sort()).toEqual(["Bass aufnehmen", "Hook in A-Moll"]);

    const live = createItem({ projectId: PROJECT.id, kind: "note", title: "Drop ab Takt 33" }, { author: "Gast", site: "guestsite", clock: 5 });
    await p.hubs.guest.merge(PROJECT.id, [live]);
    p.guest.publishHub([live]);
    for (let i = 0; i < 4; i++) await flush();
    expect(p.hubs.host.items.has(live.id)).toBe(true);
    expect(p.host.state.hubRevision).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ Dateien

class MemSink implements TransferSink {
  parts = new Map<string, { name: string; size: number; sha: string; data: number[] }>();
  saved = new Map<string, Uint8Array>();
  keep = new Map<string, number[]>(); // sha -> Teil
  async begin(id: string, name: string, size: number, sha: string) {
    const prev = this.keep.get(sha) ?? [];
    this.parts.set(id, { name, size, sha, data: [...prev] });
    return { fileName: name, resumeOffset: prev.length };
  }
  async write(id: string, offset: number, data: Uint8Array) {
    const p = this.parts.get(id)!;
    if (offset !== p.data.length) throw new Error("Lücke");
    p.data.push(...data);
    return p.data.length;
  }
  async finish(id: string) {
    const p = this.parts.get(id)!;
    const bytes = Uint8Array.from(p.data);
    const sha = await sha256Hex(bytes);
    if (sha !== p.sha) throw new Error("Prüfsumme stimmt nicht");
    this.saved.set(p.name, bytes);
    this.keep.delete(p.sha);
    return { fileName: p.name, sha256: sha, verified: true, size: bytes.length };
  }
  async cancel(id: string, keepPartial: boolean) {
    const p = this.parts.get(id);
    if (p && keepPartial) this.keep.set(p.sha, p.data);
    this.parts.delete(id);
  }
}

function filePair(opts: { dropAfterFrames?: number } = {}) {
  const sinks = { a: new MemSink(), b: new MemSink() };
  let frames = 0;
  let up = true;
  // eslint-disable-next-line prefer-const
  let a: FileTransfers, b: FileTransfers;
  const linkTo = (to: () => FileTransfers) => ({
    sendControl: (m: SessionMessage) => {
      if (!up) return;
      const parsed = parseSessionMessage(JSON.stringify(m))!;
      queueMicrotask(() => void to().handleControl(parsed));
    },
    sendBinary: async (buf: ArrayBuffer) => {
      if (!up) throw new Error("Kanal geschlossen");
      frames++;
      if (opts.dropAfterFrames && frames === opts.dropAfterFrames) {
        up = false;
        throw new Error("Kanal geschlossen");
      }
      to().handleBinary(buf.slice(0));
      await flush();
    },
  });
  a = new FileTransfers(linkTo(() => b), sinks.a);
  b = new FileTransfers(linkTo(() => a), sinks.b);
  return { a, b, sinks, reconnect: () => { up = true; frames = 0; opts.dropAfterFrames = undefined; } };
}

async function settle(n = 60) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 1));
}

const wav = (n: number) => new File([Uint8Array.from({ length: n }, (_, i) => (i * 31) % 256)], "Kick 01.wav", { type: "audio/wav" });

describe("Sample-Austausch", () => {
  it("überträgt mit identischer Prüfsumme nach ausdrücklicher Annahme", async () => {
    const p = filePair();
    const f = wav(200_000);
    expect(await p.a.offer([f])).toEqual([]);
    await settle();
    const incoming = p.b.list[0];
    expect(incoming.status).toBe("incoming");
    expect(p.sinks.b.saved.size).toBe(0); // ohne Annahme wird nichts geschrieben
    await p.b.accept(incoming.id);
    await settle(200);
    expect(p.b.list[0].status).toBe("done");
    expect(p.a.list[0].status).toBe("done");
    const got = p.sinks.b.saved.get("Kick 01.wav")!;
    expect(await sha256Hex(got)).toBe(await sha256Hex(new Uint8Array(await f.arrayBuffer())));
    expect(p.a.list[0].rateBps).toBeGreaterThan(0);
  });

  it("lehnt nicht erlaubte Dateitypen schon beim Sender ab", async () => {
    const p = filePair();
    const problems = await p.a.offer([new File(["MZ"], "setup.exe")]);
    expect(problems[0]).toMatch(/nicht erlaubt/);
    expect(p.a.list).toHaveLength(0);
  });

  it("Ablehnung durch den Empfänger", async () => {
    const p = filePair();
    await p.a.offer([wav(1000)]);
    await settle();
    p.b.reject(p.b.list[0].id);
    await settle();
    expect(p.a.list[0].status).toBe("rejected");
  });

  it("setzt nach Verbindungsabbruch fort, statt neu zu beginnen", async () => {
    const p = filePair({ dropAfterFrames: 2 });
    const f = wav(300_000);
    await p.a.offer([f]);
    await settle();
    await p.b.accept(p.b.list[0].id);
    await settle(100);
    await p.a.peerLost();
    await p.b.peerLost();
    expect(p.b.list[0].status).toBe("interrupted");
    p.reconnect();
    await p.a.resend(p.a.list[0].id);
    await settle();
    const again = p.b.list[0];
    await p.b.accept(again.id);
    await settle(200);
    expect(p.b.list[0].resumedFrom).toBe(65536);
    expect(p.b.list[0].status).toBe("done");
    expect(p.sinks.b.saved.get("Kick 01.wav")!.length).toBe(300_000);
  });
});
