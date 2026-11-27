// WebRTC-Sitzung: Signalisierung, PeerConnection, Medien, Datenkanäle, Messwerte.
//
// Transceiver-Belegung (Reihenfolge fest, vom Host angelegt – keine Neuverhandlung nötig):
//   0 Mikrofon (Talkback)   1 Kamera   2 Bildschirm   3 Systemton / DAW-Mix
// Mikrofon und DAW-Mix laufen damit getrennt; der DAW-Mix enthält das eigene
// Mikrofon nicht, solange es nicht über Live geroutet wird (siehe Doku).
import {
  parseSessionMessage, securityCode, type HubProject, type Invite, type SessionMessage, type SessionMode, type SessionRole,
} from "@lom/protocol";
import { SessionCore, errText, type CoreState, type HubBackend, type LocalDaw } from "./core";
import { FileTransfers, type Transfer, type TransferSink } from "./files";

export type Quality = "auto" | "low" | "medium" | "high";
const BITRATE: Record<Exclude<Quality, "auto">, number> = { low: 300_000, medium: 1_000_000, high: 2_500_000 };

export interface RemoteMedia {
  mic: boolean;
  cam: boolean;
  screen: boolean;
  screenAudio: boolean;
}

export interface NetStats {
  /** "host" = direkt im LAN, "srflx"/"prflx" = direkt über NAT (STUN), "relay" = über TURN */
  candidateType: string | null;
  rttMs: number | null;
  audioJitterMs: number | null;
  videoJitterMs: number | null;
  packetLossPct: number | null;
  inKbps: number | null;
  outKbps: number | null;
  availableOutKbps: number | null;
  measuredAt: number;
}

export interface RtcSnapshot {
  signaling: "connecting" | "open" | "closed" | "error";
  signalingError: string | null;
  peerPresent: boolean;
  pcState: RTCPeerConnectionState | "none";
  /** gemessen: vom Senden des Angebots bis "connected" */
  setupMs: number | null;
  securityCode: string | null;
  localStream: MediaStream | null;
  remoteCam: MediaStream | null;
  remoteScreen: MediaStream | null;
  screenStream: MediaStream | null;
  mic: boolean;
  cam: boolean;
  screenAudio: boolean;
  mediaError: string | null;
  remoteMedia: RemoteMedia;
  stats: NetStats | null;
  quality: Quality;
  core: CoreState;
  transfers: Transfer[];
}

export interface RtcOptions {
  role: SessionRole;
  mode: SessionMode;
  name: string;
  siteId: string;
  appVersion: string;
  project: HubProject | null;
  invite: Invite;
  extraIce: RTCIceServer[];
  daw: LocalDaw;
  hub: HubBackend;
  sink: TransferSink;
  mediaDevices?: { audioId?: string; videoId?: string };
  withMedia?: boolean;
}

type Signal = { kind: "offer" | "answer"; sdp: string } | { kind: "ice"; candidate: RTCIceCandidateInit };

export class RtcSession {
  readonly core: SessionCore;
  readonly files: FileTransfers;
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private control: RTCDataChannel | null = null;
  private fileCh: RTCDataChannel | null = null;
  private iceServers: RTCIceServer[] = [];
  private pendingIce: RTCIceCandidateInit[] = [];
  private ended = false;
  private wsRetry = 0;
  private offerStarted = 0;
  private lossHandled = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private lastBytes: { at: number; inB: number; outB: number } | null = null;
  private listeners = new Set<(s: RtcSnapshot) => void>();
  private snap: Omit<RtcSnapshot, "core" | "transfers">;

  constructor(private o: RtcOptions) {
    this.core = new SessionCore({
      role: o.role,
      mode: o.mode,
      name: o.name,
      siteId: o.siteId,
      appVersion: o.appVersion,
      project: o.project,
      daw: o.daw,
      hub: o.hub,
      send: (m) => this.sendControl(m),
    });
    this.files = new FileTransfers({ sendControl: (m) => this.sendControl(m), sendBinary: (b) => this.sendBinary(b) }, o.sink);
    this.snap = {
      signaling: "connecting",
      signalingError: null,
      peerPresent: false,
      pcState: "none",
      setupMs: null,
      securityCode: null,
      localStream: null,
      remoteCam: null,
      remoteScreen: null,
      screenStream: null,
      mic: true,
      cam: true,
      screenAudio: false,
      mediaError: null,
      remoteMedia: { mic: false, cam: false, screen: false, screenAudio: false },
      stats: null,
      quality: "auto",
    };
    this.core.onChange(() => this.emit());
    this.files.onChange(() => this.emit());
  }

  get invite(): Invite {
    return this.o.invite;
  }

  get role(): SessionRole {
    return this.o.role;
  }

  get snapshot(): RtcSnapshot {
    return { ...this.snap, core: this.core.state, transfers: this.files.list };
  }

  onChange(cb: (s: RtcSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    const s = this.snapshot;
    this.listeners.forEach((l) => l(s));
  }

  private set(p: Partial<RtcSession["snap"]>) {
    this.snap = { ...this.snap, ...p };
    this.emit();
  }

  // ---------------------------------------------------------------- Start / Ende

  async start() {
    this.core.setPhase(this.o.role === "host" ? "waiting" : "connecting");
    if (this.o.withMedia !== false) await this.startLocalMedia(this.o.mediaDevices);
    this.connectSignaling();
    this.timers.push(setInterval(() => void this.core.tick(), 1000));
    this.timers.push(setInterval(() => void this.pollStats(), 2000));
  }

  end() {
    if (this.ended) return;
    this.core.end();
    this.ended = true;
    void this.files.peerLost();
    try {
      this.ws?.send(JSON.stringify({ type: "leave" }));
    } catch {
      /* egal */
    }
    this.ws?.close();
    this.closePc();
    this.timers.forEach(clearInterval);
    this.snap.localStream?.getTracks().forEach((t) => t.stop());
    this.snap.screenStream?.getTracks().forEach((t) => t.stop());
    this.set({ signaling: "closed", localStream: null, screenStream: null, remoteCam: null, remoteScreen: null });
  }

  // ---------------------------------------------------------------- Signalisierung

  private connectSignaling() {
    if (this.ended) return;
    this.set({ signaling: "connecting" });
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.o.invite.server);
    } catch (e) {
      this.set({ signaling: "error", signalingError: `Server nicht erreichbar: ${errText(e)}` });
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.wsRetry = 0;
      ws.send(
        JSON.stringify({
          type: "join",
          room: this.o.invite.room,
          token: this.o.invite.token,
          role: this.o.role,
          name: this.o.name,
          ...(this.o.role === "host" && this.o.invite.expiresAt ? { expiresAt: this.o.invite.expiresAt } : {}),
        }),
      );
    };
    ws.onmessage = (e) => void this.onServer(String(e.data));
    ws.onclose = () => {
      if (this.ended || this.ws !== ws) return;
      this.set({ signaling: "closed" });
      // Laufende WebRTC-Verbindung bleibt bestehen; Signalisierung neu aufbauen.
      const delay = Math.min(10_000, 1000 * 2 ** this.wsRetry++);
      setTimeout(() => this.connectSignaling(), delay);
    };
    ws.onerror = () => {
      if (!this.snap.signalingError) this.set({ signalingError: `Signalisierungsserver ${this.o.invite.server} nicht erreichbar` });
    };
  }

  private sendSignal(data: Signal) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "signal", data }));
  }

  private async onServer(raw: string) {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    switch (m.type) {
      case "joined": {
        const fromServer = Array.isArray(m.iceServers) ? (m.iceServers as RTCIceServer[]) : [];
        this.iceServers = [...fromServer, ...this.o.extraIce];
        this.set({ signaling: "open", signalingError: null, peerPresent: !!m.peerName });
        if (this.o.role === "host" && m.peerName) await this.startOffer();
        return;
      }
      case "peerJoined":
        this.set({ peerPresent: true });
        if (this.o.role === "host") await this.startOffer();
        return;
      case "peerLeft":
        this.set({ peerPresent: false });
        this.handleLoss("Gegenüber hat die Verbindung getrennt");
        return;
      case "signal":
        await this.onSignal(m.data as Signal);
        return;
      case "error": {
        const msg = String(m.message ?? "Fehler");
        this.set({ signaling: "error", signalingError: msg });
        if (m.code === "no-room" && this.o.role === "guest" && !this.ended) {
          // Host noch nicht online – erneut versuchen
          setTimeout(() => this.connectSignaling(), 3000);
        }
        return;
      }
    }
  }

  // ---------------------------------------------------------------- PeerConnection

  private newPc(): RTCPeerConnection {
    this.closePc();
    this.lossHandled = false;
    this.lastBytes = null;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal({ kind: "ice", candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      this.set({ pcState: pc.connectionState });
      if (pc.connectionState === "connected") {
        if (this.offerStarted && this.snap.setupMs === null) this.set({ setupMs: performance.now() - this.offerStarted });
        void this.updateSecurityCode();
      }
      if (pc.connectionState === "failed") {
        this.handleLoss("Verbindung fehlgeschlagen");
        if (this.o.role === "host" && this.snap.peerPresent) setTimeout(() => void this.startOffer(), 1500);
      }
      if (pc.connectionState === "disconnected") {
        setTimeout(() => {
          if (this.pc === pc && pc.connectionState === "disconnected") {
            this.handleLoss("Verbindung unterbrochen");
            if (this.o.role === "host" && this.snap.peerPresent) void this.startOffer();
          }
        }, 5000);
      }
    };
    pc.ontrack = (e) => this.onTrack(pc, e);
    pc.ondatachannel = (e) => this.setupChannel(e.channel);
    return pc;
  }

  private closePc() {
    const pc = this.pc;
    this.pc = null;
    this.control = null;
    this.fileCh = null;
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.close();
    }
    this.pendingIce = [];
    this.set({ pcState: "none", securityCode: null, remoteCam: null, remoteScreen: null });
  }

  private handleLoss(reason: string) {
    if (this.lossHandled || this.ended) return;
    this.lossHandled = true;
    this.core.peerLost(reason);
    void this.files.peerLost();
    this.set({ remoteMedia: { mic: false, cam: false, screen: false, screenAudio: false } });
  }

  private async startOffer() {
    if (this.ended) return;
    const pc = this.newPc();
    this.setupChannel(pc.createDataChannel("control", { ordered: true }));
    this.setupChannel(pc.createDataChannel("files", { ordered: true }));
    const tracks = this.localTracks();
    for (let i = 0; i < 4; i++) {
      const kind = i === 1 || i === 2 ? "video" : "audio";
      pc.addTransceiver(tracks[i] ?? kind, { direction: "sendrecv" });
    }
    this.offerStarted = performance.now();
    this.set({ setupMs: null });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal({ kind: "offer", sdp: offer.sdp! });
    void this.applyQuality();
  }

  private async onSignal(d: Signal) {
    if (!d || typeof d !== "object") return;
    if (d.kind === "offer" && this.o.role === "guest") {
      const pc = this.newPc();
      this.offerStarted = performance.now();
      this.set({ setupMs: null });
      await pc.setRemoteDescription({ type: "offer", sdp: d.sdp });
      const tracks = this.localTracks();
      pc.getTransceivers().forEach((t, i) => {
        t.direction = "sendrecv";
        void t.sender.replaceTrack(tracks[i] ?? null);
      });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal({ kind: "answer", sdp: answer.sdp! });
      await this.flushIce();
      void this.applyQuality();
    } else if (d.kind === "answer" && this.o.role === "host" && this.pc) {
      await this.pc.setRemoteDescription({ type: "answer", sdp: d.sdp });
      await this.flushIce();
    } else if (d.kind === "ice") {
      if (this.pc?.remoteDescription) await this.pc.addIceCandidate(d.candidate).catch(() => {});
      else this.pendingIce.push(d.candidate);
    }
  }

  private async flushIce() {
    const q = this.pendingIce;
    this.pendingIce = [];
    for (const c of q) await this.pc?.addIceCandidate(c).catch(() => {});
  }

  private setupChannel(ch: RTCDataChannel) {
    ch.binaryType = "arraybuffer";
    if (ch.label === "control") {
      this.control = ch;
      ch.onopen = () => {
        this.core.connected();
        this.announceMedia();
      };
      ch.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        const m = parseSessionMessage(e.data);
        if (!m) return;
        if (m.t.startsWith("file-")) void this.files.handleControl(m);
        else if (m.t === "media") this.set({ remoteMedia: { mic: m.mic, cam: m.cam, screen: m.screen, screenAudio: m.screenAudio } });
        else void this.core.handle(m);
      };
      ch.onclose = () => this.handleLoss("Steuerkanal geschlossen");
    } else if (ch.label === "files") {
      this.fileCh = ch;
      ch.bufferedAmountLowThreshold = 256 * 1024;
      ch.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) this.files.handleBinary(e.data);
      };
    }
  }

  private sendControl(m: SessionMessage) {
    if (this.control?.readyState === "open") this.control.send(JSON.stringify(m));
  }

  /** Dateirahmen senden; wartet bei vollem Puffer, damit der Steuerkanal Vorrang behält. */
  private async sendBinary(buf: ArrayBuffer): Promise<void> {
    const ch = this.fileCh;
    if (!ch || ch.readyState !== "open") throw new Error("Datei-Kanal nicht offen");
    if (ch.bufferedAmount > 1024 * 1024) {
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          ch.removeEventListener("bufferedamountlow", done);
          ch.removeEventListener("close", fail);
          resolve();
        };
        const fail = () => reject(new Error("Datei-Kanal geschlossen"));
        ch.addEventListener("bufferedamountlow", done);
        ch.addEventListener("close", fail);
      });
    }
    ch.send(buf);
  }

  private async updateSecurityCode() {
    const l = this.pc?.localDescription?.sdp;
    const r = this.pc?.remoteDescription?.sdp;
    if (!l || !r) return;
    try {
      this.set({ securityCode: await securityCode(l, r) });
    } catch {
      this.set({ securityCode: null });
    }
  }

  // ---------------------------------------------------------------- Medien

  /** [mic, cam, screenVideo, screenAudio] */
  private localTracks(): (MediaStreamTrack | null)[] {
    const ls = this.snap.localStream;
    const ss = this.snap.screenStream;
    return [ls?.getAudioTracks()[0] ?? null, ls?.getVideoTracks()[0] ?? null, ss?.getVideoTracks()[0] ?? null, ss?.getAudioTracks()[0] ?? null];
  }

  private onTrack(pc: RTCPeerConnection, e: RTCTrackEvent) {
    const idx = pc.getTransceivers().indexOf(e.transceiver);
    const cam = this.snap.remoteCam ?? new MediaStream();
    const screen = this.snap.remoteScreen ?? new MediaStream();
    if (idx === 0 || idx === 1) {
      cam.getTracks().filter((t) => t.kind === e.track.kind).forEach((t) => cam.removeTrack(t));
      cam.addTrack(e.track);
      this.set({ remoteCam: cam });
    } else if (idx === 2 || idx === 3) {
      screen.getTracks().filter((t) => t.kind === e.track.kind).forEach((t) => screen.removeTrack(t));
      screen.addTrack(e.track);
      this.set({ remoteScreen: screen });
    }
  }

  async startLocalMedia(dev?: { audioId?: string; videoId?: string }) {
    const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(dev?.audioId ? { deviceId: { exact: dev.audioId } } : {}) };
    const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, ...(dev?.videoId ? { deviceId: { exact: dev.videoId } } : {}) };
    let stream: MediaStream | null = null;
    let error: string | null = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      error = "Diese Umgebung unterstützt keinen Kamera-/Mikrofonzugriff";
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio, video });
      } catch (e1) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio });
          error = `Keine Kamera verfügbar (${errText(e1)}) – nur Ton`;
        } catch (e2) {
          error = `Kein Zugriff auf Kamera/Mikrofon: ${errText(e2)}`;
        }
      }
    }
    this.snap.localStream?.getTracks().forEach((t) => t.stop());
    stream?.getAudioTracks().forEach((t) => (t.enabled = this.snap.mic));
    stream?.getVideoTracks().forEach((t) => (t.enabled = this.snap.cam));
    this.set({ localStream: stream, mediaError: error });
    await this.replaceSenders();
    this.announceMedia();
  }

  private async replaceSenders() {
    const pc = this.pc;
    if (!pc) return;
    const tracks = this.localTracks();
    await Promise.all(pc.getTransceivers().slice(0, 4).map((t, i) => t.sender.replaceTrack(tracks[i]).catch(() => {})));
  }

  setMic(on: boolean) {
    this.snap.localStream?.getAudioTracks().forEach((t) => (t.enabled = on));
    this.set({ mic: on });
    this.announceMedia();
  }

  setCam(on: boolean) {
    this.snap.localStream?.getVideoTracks().forEach((t) => (t.enabled = on));
    this.set({ cam: on });
    this.announceMedia();
  }

  /** Bildschirm (optional mit Systemton = DAW-Mix) freigeben. */
  async shareScreen(withAudio: boolean) {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Bildschirmfreigabe wird hier nicht unterstützt");
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 } },
      // restrictOwnAudio: eigene App-Wiedergabe (Stimme des Partners) nicht mitsenden, wo unterstützt
      audio: withAudio ? ({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true } as MediaTrackConstraints) : false,
    });
    s.getVideoTracks()[0]?.addEventListener("ended", () => this.stopScreen());
    this.snap.screenStream?.getTracks().forEach((t) => t.stop());
    this.set({ screenStream: s, screenAudio: s.getAudioTracks().length > 0 });
    await this.replaceSenders();
    this.announceMedia();
  }

  stopScreen() {
    this.snap.screenStream?.getTracks().forEach((t) => t.stop());
    this.set({ screenStream: null, screenAudio: false });
    void this.replaceSenders();
    this.announceMedia();
  }

  private announceMedia() {
    const ls = this.snap.localStream;
    this.sendControl({
      t: "media",
      mic: this.snap.mic && !!ls?.getAudioTracks().length,
      cam: this.snap.cam && !!ls?.getVideoTracks().length,
      screen: !!this.snap.screenStream,
      screenAudio: this.snap.screenAudio,
    });
  }

  async setQuality(q: Quality) {
    this.set({ quality: q });
    await this.applyQuality();
  }

  private async applyQuality() {
    const pc = this.pc;
    if (!pc) return;
    for (const i of [1, 2]) {
      const sender = pc.getTransceivers()[i]?.sender;
      if (!sender) continue;
      const p = sender.getParameters();
      if (!p.encodings || p.encodings.length === 0) p.encodings = [{}];
      if (this.snap.quality === "auto") delete p.encodings[0].maxBitrate;
      else p.encodings[0].maxBitrate = BITRATE[this.snap.quality] * (i === 2 ? 2 : 1);
      await sender.setParameters(p).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- Messwerte

  private async pollStats() {
    const pc = this.pc;
    if (!pc || pc.connectionState !== "connected") return;
    const report = await pc.getStats();
    let pair: RTCIceCandidatePairStats | undefined;
    const byId = new Map<string, Record<string, unknown>>();
    report.forEach((r) => byId.set(r.id, r));
    report.forEach((r) => {
      if (r.type === "transport" && r.selectedCandidatePairId) pair = byId.get(r.selectedCandidatePairId) as unknown as RTCIceCandidatePairStats;
    });
    if (!pair)
      report.forEach((r) => {
        if (r.type === "candidate-pair" && r.state === "succeeded" && (r.nominated || r.selected)) pair = r as RTCIceCandidatePairStats;
      });
    let inB = 0;
    let outB = 0;
    let lost = 0;
    let recv = 0;
    let aj: number | null = null;
    let vj: number | null = null;
    report.forEach((r) => {
      if (r.type === "inbound-rtp") {
        inB += r.bytesReceived ?? 0;
        lost += Math.max(0, r.packetsLost ?? 0);
        recv += r.packetsReceived ?? 0;
        if (r.kind === "audio" && typeof r.jitter === "number") aj = Math.max(aj ?? 0, r.jitter * 1000);
        if (r.kind === "video" && typeof r.jitter === "number") vj = Math.max(vj ?? 0, r.jitter * 1000);
      }
      if (r.type === "outbound-rtp") outB += r.bytesSent ?? 0;
    });
    const now = performance.now();
    let inKbps: number | null = null;
    let outKbps: number | null = null;
    if (this.lastBytes) {
      const dt = (now - this.lastBytes.at) / 1000;
      inKbps = ((inB - this.lastBytes.inB) * 8) / 1000 / dt;
      outKbps = ((outB - this.lastBytes.outB) * 8) / 1000 / dt;
    }
    this.lastBytes = { at: now, inB, outB };
    const local = pair ? (byId.get(String(pair.localCandidateId)) as { candidateType?: string } | undefined) : undefined;
    this.set({
      stats: {
        candidateType: local?.candidateType ?? null,
        rttMs: typeof pair?.currentRoundTripTime === "number" ? pair.currentRoundTripTime * 1000 : null,
        audioJitterMs: aj,
        videoJitterMs: vj,
        packetLossPct: recv + lost > 0 ? (lost / (recv + lost)) * 100 : null,
        inKbps,
        outKbps,
        availableOutKbps: typeof pair?.availableOutgoingBitrate === "number" ? pair.availableOutgoingBitrate / 1000 : null,
        measuredAt: Date.now(),
      },
    });
  }
}
