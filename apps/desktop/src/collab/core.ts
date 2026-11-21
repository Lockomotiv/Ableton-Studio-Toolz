// Sitzungslogik ohne Transport: Rollen, Steuerfreigabe, DAW-Fernsteuerung,
// Transport-Kopplung (Dual Studio) und Hub-Abgleich.
// Der WebRTC-Teil (rtc.ts) liefert nur `connected()`, `peerLost()` und `handle()`.
import type { CommandOutcome, DawCommand, LiveStatus, TrackInfo } from "@lom/shared-types";
import {
  describeCommand, isValidHubItem, MIRRORABLE, PROTOCOL_VERSION, randomHex, validateCommand,
  type ControlMode, type HubItem, type HubProject, type SessionMessage, type SessionMode, type SessionRole,
} from "@lom/protocol";

export interface LocalDaw {
  execute(c: DawCommand): Promise<CommandOutcome>;
  status(): Promise<LiveStatus>;
  tracks(): Promise<TrackInfo[]>;
}

export interface HubBackend {
  ensureProject(p: HubProject): Promise<void>;
  list(projectId: string): Promise<HubItem[]>;
  merge(projectId: string, items: HubItem[]): Promise<HubItem[]>;
}

export type Phase = "idle" | "waiting" | "connecting" | "connected" | "reconnecting" | "ended";

export interface SessionEvent {
  at: number;
  level: "info" | "warn" | "error";
  text: string;
}

export interface CoreState {
  phase: Phase;
  role: SessionRole;
  mode: SessionMode;
  selfName: string;
  peerName: string | null;
  peerVersion: string | null;
  project: HubProject | null;
  /** Wer die DAW des Hosts steuern darf (Remote Studio). Auf dem Host maßgeblich. */
  control: ControlMode;
  /** Host: Gast hat angefragt · Gast: Anfrage läuft */
  controlRequested: boolean;
  remoteStatus: LiveStatus | null;
  remoteStatusError: string | null;
  remoteTracks: TrackInfo[];
  /** Dual Studio: eigenen Transport spiegeln und gespiegelte Befehle annehmen */
  transportLink: boolean;
  peerTransportLink: boolean;
  /** gemessene Roundtrip-Zeit des Steuerkanals (ping/pong) */
  controlRttMs: number | null;
  hubRevision: number;
  events: SessionEvent[];
}

export interface CoreOptions {
  role: SessionRole;
  mode: SessionMode;
  name: string;
  siteId: string;
  appVersion: string;
  /** Host: Projekt, an dem gemeinsam gearbeitet wird. Gast: übernimmt das Projekt des Hosts. */
  project: HubProject | null;
  daw: LocalDaw;
  hub: HubBackend;
  send: (m: SessionMessage) => void;
  now?: () => number;
}

const REMOTE_TIMEOUT_MS = 8000;
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 20;

export class SessionCore {
  private s: CoreState;
  private listeners = new Set<(s: CoreState) => void>();
  private pending = new Map<string, { resolve: (o: CommandOutcome) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private rate: number[] = [];
  private tickCount = 0;
  private lastTrackCount = -1;
  private now: () => number;

  constructor(private o: CoreOptions) {
    this.now = o.now ?? Date.now;
    this.s = {
      phase: "idle",
      role: o.role,
      mode: o.mode,
      selfName: o.name,
      peerName: null,
      peerVersion: null,
      project: o.project,
      control: "host",
      controlRequested: false,
      remoteStatus: null,
      remoteStatusError: null,
      remoteTracks: [],
      transportLink: o.mode === "dual",
      peerTransportLink: false,
      controlRttMs: null,
      hubRevision: 0,
      events: [],
    };
  }

  get state(): CoreState {
    return this.s;
  }

  onChange(cb: (s: CoreState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private set(p: Partial<CoreState>) {
    this.s = { ...this.s, ...p };
    this.listeners.forEach((l) => l(this.s));
  }

  private log(text: string, level: SessionEvent["level"] = "info") {
    this.set({ events: [{ at: this.now(), level, text }, ...this.s.events].slice(0, 100) });
  }

  setPhase(phase: Phase) {
    this.set({ phase });
  }

  // ---------------------------------------------------------------- Lebenszyklus

  /** Steuerkanal ist offen. */
  connected() {
    this.set({ phase: "connected" });
    const project = this.s.project ?? { id: "pending", name: "", createdMs: 0 };
    this.o.send({
      t: "hello",
      v: PROTOCOL_VERSION,
      name: this.s.selfName,
      role: this.s.role,
      mode: this.s.mode,
      appVersion: this.o.appVersion,
      project,
      siteId: this.o.siteId,
    });
    if (this.s.role === "host") this.o.send({ t: "control", control: this.s.control });
  }

  /** Verbindung verloren: Fernsteuerung SOFORT sperren. */
  peerLost(reason: string) {
    const hadControl = this.s.control !== "host";
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Verbindung zum Host unterbrochen"));
    }
    this.pending.clear();
    this.set({
      phase: this.s.phase === "ended" ? "ended" : "reconnecting",
      control: "host",
      controlRequested: false,
      remoteStatus: null,
      remoteStatusError: null,
      peerTransportLink: false,
      controlRttMs: null,
    });
    this.log(`Verbindung unterbrochen (${reason})${hadControl ? " – Steuerfreigabe des Gastes aufgehoben" : ""}`, "warn");
  }

  end() {
    try {
      this.o.send({ t: "bye" });
    } catch {
      /* Kanal evtl. schon zu */
    }
    this.peerLost("Sitzung beendet");
    this.set({ phase: "ended" });
  }

  /** Periodisch (1 s) aufrufen. */
  async tick() {
    if (this.s.phase !== "connected") return;
    this.tickCount++;
    if (this.tickCount % 2 === 0) this.o.send({ t: "ping", ts: this.now() });
    if (this.s.role === "host" && this.s.mode === "remote") {
      let status: LiveStatus | null = null;
      let error: string | null = null;
      try {
        status = await this.o.daw.status();
      } catch (e) {
        error = errText(e);
      }
      let tracks: TrackInfo[] | undefined;
      if (status && (status.numTracks !== this.lastTrackCount || this.tickCount % 5 === 0)) {
        try {
          tracks = await this.o.daw.tracks();
          this.lastTrackCount = status.numTracks;
        } catch {
          /* nächster Versuch */
        }
      }
      this.o.send({ t: "daw-state", status, error, tracks });
    }
  }

  // ---------------------------------------------------------------- Steuerfreigabe

  /** Darf der Host gerade selbst Befehle an seine DAW geben? */
  get hostMayControl(): boolean {
    return this.s.control !== "guest";
  }

  /** Darf der Gast gerade die DAW des Hosts steuern? */
  get guestMayControl(): boolean {
    return this.s.mode === "remote" && this.s.control !== "host" && this.s.phase === "connected";
  }

  setControl(control: ControlMode) {
    if (this.s.role !== "host") throw new Error("Nur der Host vergibt die Steuerung");
    this.set({ control, controlRequested: false });
    this.o.send({ t: "control", control });
    this.log(
      control === "host" ? "Steuerung liegt beim Host" : control === "shared" ? "Gemeinsame Steuerung freigegeben" : "Steuerung komplett an den Gast übergeben",
    );
  }

  requestControl() {
    if (this.s.role !== "guest") return;
    this.set({ controlRequested: true });
    this.o.send({ t: "control-request" });
    this.log("Steuerung beim Host angefragt");
  }

  answerRequest(grant: boolean, control: Exclude<ControlMode, "host"> = "shared") {
    if (this.s.role !== "host") return;
    if (grant) this.setControl(control);
    else {
      this.set({ controlRequested: false });
      this.o.send({ t: "control-denied" });
      this.log("Steuerungsanfrage abgelehnt");
    }
  }

  releaseControl() {
    if (this.s.role !== "guest") return;
    this.o.send({ t: "control-release" });
  }

  // ---------------------------------------------------------------- DAW

  /** Gast: Befehl an die DAW des Hosts senden. */
  executeRemote(command: DawCommand): Promise<CommandOutcome> {
    if (this.s.role !== "guest" || this.s.mode !== "remote") return Promise.reject(new Error("Nur Gäste im Remote Studio"));
    if (this.s.phase !== "connected") return Promise.reject(new Error("Nicht mit dem Host verbunden"));
    if (this.s.control === "host") return Promise.reject(new Error("Keine Steuerfreigabe – bitte beim Host anfragen"));
    const problem = validateCommand(command);
    if (problem) return Promise.reject(new Error(problem));
    const id = randomHex(8);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Keine Antwort vom Host (Timeout)"));
      }, REMOTE_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.o.send({ t: "daw-cmd", id, command });
    });
  }

  /** Nach einem lokal ausgeführten Befehl aufrufen (Dual Studio: Spiegeln). */
  afterLocalCommand(command: DawCommand) {
    if (this.s.mode === "dual" && this.s.transportLink && this.s.phase === "connected" && MIRRORABLE.has(command.type)) {
      this.o.send({ t: "mirror", command });
    }
  }

  setTransportLink(on: boolean) {
    this.set({ transportLink: on });
    this.log(on ? "Transport-Kopplung eingeschaltet" : "Transport-Kopplung ausgeschaltet");
    // Zustand dem Gegenüber über ping-ähnliche Nachricht mitteilen wäre optional;
    // gespiegelte Befehle werden ohnehin nur mit eigener Zustimmung ausgeführt.
  }

  // ---------------------------------------------------------------- Hub

  publishHub(items: HubItem[]) {
    if (this.s.phase !== "connected" || !this.s.project || items.length === 0) return;
    const own = items.filter((i) => i.projectId === this.s.project!.id);
    if (own.length) this.o.send({ t: "hub", projectId: this.s.project.id, items: own });
  }

  private async sendFullHub() {
    if (!this.s.project) return;
    const items = await this.o.hub.list(this.s.project.id);
    for (let i = 0; i < items.length; i += 500) {
      this.o.send({ t: "hub", projectId: this.s.project.id, items: items.slice(i, i + 500) });
    }
  }

  // ---------------------------------------------------------------- Eingang

  async handle(m: SessionMessage): Promise<void> {
    switch (m.t) {
      case "hello": {
        if (m.role === this.s.role) {
          this.log("Gegenüber hat dieselbe Rolle – Verbindung wird ignoriert", "error");
          return;
        }
        this.set({ peerName: m.name, peerVersion: m.appVersion });
        if (this.s.role === "guest") {
          await this.o.hub.ensureProject(m.project);
          this.set({ project: m.project, mode: m.mode, transportLink: m.mode === "dual" });
        }
        this.log(`${m.name} ist verbunden`);
        await this.sendFullHub();
        return;
      }
      case "control":
        if (this.s.role === "guest") {
          const before = this.s.control;
          this.set({ control: m.control, controlRequested: false });
          if (before !== m.control)
            this.log(m.control === "host" ? "Steuerung liegt beim Host" : m.control === "shared" ? "Gemeinsame Steuerung – Sie dürfen steuern" : "Sie haben die volle Steuerung");
        }
        return;
      case "control-request":
        if (this.s.role === "host" && this.s.mode === "remote") {
          this.set({ controlRequested: true });
          this.log(`${this.s.peerName ?? "Gast"} fragt die Steuerung an`, "warn");
        }
        return;
      case "control-denied":
        if (this.s.role === "guest") {
          this.set({ controlRequested: false });
          this.log("Der Host hat die Steuerungsanfrage abgelehnt", "warn");
        }
        return;
      case "control-release":
        if (this.s.role === "host" && this.s.control !== "host") this.setControl("host");
        return;
      case "daw-cmd":
        await this.onRemoteCommand(m.id, m.command);
        return;
      case "daw-result": {
        const p = this.pending.get(m.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        if (m.ok && m.outcome) p.resolve(m.outcome);
        else p.reject(new Error(m.error ?? "Befehl abgelehnt"));
        return;
      }
      case "daw-state":
        if (this.s.role === "guest") {
          this.set({
            remoteStatus: m.status,
            remoteStatusError: m.error,
            ...(m.tracks ? { remoteTracks: m.tracks } : {}),
          });
        }
        return;
      case "mirror":
        if (this.s.mode !== "dual") return;
        this.set({ peerTransportLink: true });
        if (!this.s.transportLink) {
          this.log(`Gespiegelter Befehl ignoriert (Kopplung aus): ${describeCommand(m.command)}`, "warn");
          return;
        }
        try {
          const o = await this.o.daw.execute(m.command);
          this.log(`${this.s.peerName ?? "Partner"}: ${describeCommand(m.command)} ${o.verified ? "✔" : "⚠"}`);
        } catch (e) {
          this.log(`Gespiegelter Befehl fehlgeschlagen: ${errText(e)}`, "error");
        }
        return;
      case "hub": {
        const project = this.s.project;
        if (!project || m.projectId !== project.id) return;
        const valid = m.items.filter((i) => isValidHubItem(i, project.id));
        if (valid.length !== m.items.length) this.log(`${m.items.length - valid.length} ungültige Hub-Einträge verworfen`, "warn");
        if (!valid.length) return;
        const applied = await this.o.hub.merge(project.id, valid);
        if (applied.length) this.set({ hubRevision: this.s.hubRevision + 1 });
        return;
      }
      case "ping":
        this.o.send({ t: "pong", ts: m.ts });
        return;
      case "pong":
        this.set({ controlRttMs: Math.max(0, this.now() - m.ts) });
        return;
      case "bye":
        this.peerLost(`${this.s.peerName ?? "Gegenüber"} hat die Sitzung beendet`);
        return;
      default:
        return; // file-* wird von FileTransfers behandelt
    }
  }

  private async onRemoteCommand(id: string, command: DawCommand) {
    const reply = (ok: boolean, extra: { outcome?: CommandOutcome; error?: string }) => this.o.send({ t: "daw-result", id, ok, ...extra });
    if (this.s.role !== "host") return;
    if (!this.guestMayControl) {
      reply(false, { error: this.s.mode === "dual" ? "Dual Studio: jeder steuert seine eigene DAW" : "Keine Steuerfreigabe durch den Host" });
      this.log(`Befehl des Gastes abgelehnt (keine Freigabe): ${describeCommand(command)}`, "warn");
      return;
    }
    const t = this.now();
    this.rate = this.rate.filter((x) => t - x < RATE_WINDOW_MS);
    if (this.rate.length >= RATE_MAX) {
      reply(false, { error: "Zu viele Befehle pro Sekunde" });
      return;
    }
    this.rate.push(t);
    try {
      const outcome = await this.o.daw.execute(command);
      // Freigabe kann während der Ausführung entzogen worden sein – Ergebnis trotzdem melden.
      reply(true, { outcome });
      this.log(`${this.s.peerName ?? "Gast"}: ${describeCommand(command)} ${outcome.verified ? "✔" : "⚠"}`);
    } catch (e) {
      reply(false, { error: errText(e) });
    }
  }
}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
