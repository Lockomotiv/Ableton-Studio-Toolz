// Sitzungsprotokoll zwischen Host und Gast (WebRTC-DataChannel "control").
// Jede eingehende Nachricht wird mit `parseSessionMessage` geprüft; alles, was
// nicht exakt diesem Schema entspricht, wird verworfen.
import type { CommandOutcome, DawCommand, LiveStatus, TrackInfo } from "@lom/shared-types";
import { validateCommand } from "./index";
import type { HubItem, HubProject } from "./hub";

export const PROTOCOL_VERSION = 1;
export const MAX_CONTROL_MESSAGE_BYTES = 512 * 1024;

export type SessionRole = "host" | "guest";
export type SessionMode = "remote" | "dual";
/** Wer darf die DAW des Hosts steuern (Remote Studio)? */
export type ControlMode = "host" | "shared" | "guest";

export type SessionMessage =
  | { t: "hello"; v: number; name: string; role: SessionRole; mode: SessionMode; appVersion: string; project: HubProject; siteId: string }
  | { t: "control"; control: ControlMode }
  | { t: "control-request" }
  | { t: "control-denied" }
  | { t: "control-release" }
  | { t: "daw-cmd"; id: string; command: DawCommand }
  | { t: "daw-result"; id: string; ok: boolean; outcome?: CommandOutcome; error?: string }
  | { t: "daw-state"; status: LiveStatus | null; error: string | null; tracks?: TrackInfo[] }
  | { t: "mirror"; command: DawCommand }
  | { t: "hub"; projectId: string; items: HubItem[] }
  | { t: "ping"; ts: number }
  | { t: "pong"; ts: number }
  | { t: "file-offer"; id: string; name: string; size: number; sha256: string }
  | { t: "file-accept"; id: string; offset: number }
  | { t: "file-reject"; id: string; reason: string }
  | { t: "file-done"; id: string; ok: boolean; sha256?: string; error?: string }
  | { t: "file-cancel"; id: string }
  | { t: "media"; mic: boolean; cam: boolean; screen: boolean; screenAudio: boolean }
  | { t: "bye" };

/** Befehle, die im Dual-Studio-Modus auf das zweite Studio gespiegelt werden dürfen. */
export const MIRRORABLE: ReadonlySet<DawCommand["type"]> = new Set(["play", "stop", "continuePlaying", "setTempo", "setLoop"]);

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SHA = /^[0-9a-f]{64}$/;
const isStr = (v: unknown, max = 256): v is string => typeof v === "string" && v.length <= max;
const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function validCommand(c: unknown): c is DawCommand {
  return isObj(c) && typeof c.type === "string" && validateCommand(c as unknown as DawCommand) === null;
}

/** Prüft eine rohe Nachricht. Liefert `null` bei allem Unerwarteten. */
export function parseSessionMessage(raw: string): SessionMessage | null {
  if (typeof raw !== "string" || raw.length > MAX_CONTROL_MESSAGE_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m) || typeof m.t !== "string") return null;
  switch (m.t) {
    case "hello":
      return isNum(m.v) && isStr(m.name, 64) && (m.role === "host" || m.role === "guest") && (m.mode === "remote" || m.mode === "dual") &&
        isStr(m.appVersion, 32) && isObj(m.project) && isId(m.project.id) && isStr(m.project.name, 120) && isNum(m.project.createdMs) && isId(m.siteId)
        ? (m as SessionMessage)
        : null;
    case "control":
      return m.control === "host" || m.control === "shared" || m.control === "guest" ? (m as SessionMessage) : null;
    case "control-request":
    case "control-denied":
    case "control-release":
    case "bye":
      return { t: m.t } as SessionMessage;
    case "daw-cmd":
      return isId(m.id) && validCommand(m.command) ? (m as SessionMessage) : null;
    case "daw-result":
      return isId(m.id) && typeof m.ok === "boolean" && (m.error === undefined || isStr(m.error, 1000)) ? (m as SessionMessage) : null;
    case "daw-state":
      return (m.status === null || isObj(m.status)) && (m.error === null || isStr(m.error, 1000)) && (m.tracks === undefined || Array.isArray(m.tracks))
        ? (m as SessionMessage)
        : null;
    case "mirror":
      return validCommand(m.command) && MIRRORABLE.has((m.command as DawCommand).type) ? (m as SessionMessage) : null;
    case "hub":
      return isId(m.projectId) && Array.isArray(m.items) && m.items.length <= 2000 ? (m as SessionMessage) : null;
    case "ping":
    case "pong":
      return isNum(m.ts) ? (m as SessionMessage) : null;
    case "file-offer":
      return isId(m.id) && isStr(m.name, 255) && isNum(m.size) && m.size > 0 && typeof m.sha256 === "string" && SHA.test(m.sha256)
        ? (m as SessionMessage)
        : null;
    case "file-accept":
      return isId(m.id) && isNum(m.offset) && m.offset >= 0 ? (m as SessionMessage) : null;
    case "file-reject":
      return isId(m.id) && isStr(m.reason, 500) ? (m as SessionMessage) : null;
    case "file-done":
      return isId(m.id) && typeof m.ok === "boolean" ? (m as SessionMessage) : null;
    case "file-cancel":
      return isId(m.id) ? (m as SessionMessage) : null;
    case "media":
      return typeof m.mic === "boolean" && typeof m.cam === "boolean" && typeof m.screen === "boolean" && typeof m.screenAudio === "boolean"
        ? (m as SessionMessage)
        : null;
    default:
      return null;
  }
}

// ------------------------------------------------------------------ Einladungen

export interface Invite {
  /** Signalisierungsserver, z. B. wss://signal.example.org oder ws://192.168.1.20:47870 */
  server: string;
  room: string;
  token: string;
  hostName: string;
  mode: SessionMode;
}

const INVITE_PREFIX = "LOM1.";

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function createInvite(server: string, hostName: string, mode: SessionMode): Invite {
  return { server, room: randomHex(8), token: randomHex(24), hostName, mode };
}

export function encodeInvite(i: Invite): string {
  return INVITE_PREFIX + b64urlEncode(JSON.stringify({ s: i.server, r: i.room, t: i.token, h: i.hostName, m: i.mode }));
}

/** Liest einen Einladungscode. Wirft eine verständliche Fehlermeldung. */
export function decodeInvite(code: string): Invite {
  const c = code.trim();
  if (!c.startsWith(INVITE_PREFIX)) throw new Error("Kein gültiger Einladungscode (muss mit LOM1. beginnen)");
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(b64urlDecode(c.slice(INVITE_PREFIX.length)));
  } catch {
    throw new Error("Einladungscode ist beschädigt");
  }
  const server = String(o.s ?? "");
  if (!/^wss?:\/\/[^\s]+$/.test(server)) throw new Error("Einladung enthält keine gültige Serveradresse");
  if (!isId(o.r) || typeof o.t !== "string" || !/^[0-9a-f]{32,128}$/.test(o.t)) throw new Error("Einladung unvollständig");
  return {
    server,
    room: o.r,
    token: o.t,
    hostName: isStr(o.h, 64) ? o.h : "Host",
    mode: o.m === "dual" ? "dual" : "remote",
  };
}

/** Unverschlüsselte Verbindung (ws://) außerhalb privater Netze? */
export function isInsecureServer(server: string): boolean {
  const m = /^ws:\/\/\[?([^\]/:]+)/.exec(server);
  if (!m) return false;
  const h = m[1];
  const priv =
    h === "localhost" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h.endsWith(".local");
  return !priv;
}

// ------------------------------------------------------------------ Sicherheitscode

/** Extrahiert die DTLS-Fingerprints ("a=fingerprint:sha-256 AB:CD…") aus einer SDP. */
export function sdpFingerprints(sdp: string): string[] {
  return Array.from(new Set(sdp.match(/a=fingerprint:\S+ [0-9A-Fa-f:]+/g) ?? [])).map((s) => s.slice(14).toUpperCase());
}

/**
 * Sechsstelliger Code aus beiden DTLS-Fingerprints. Stimmen die Codes auf beiden
 * Seiten überein, sitzt niemand (auch nicht der Signalisierungsserver) zwischen
 * den Teilnehmern. Vorlesen über die Videoverbindung genügt.
 */
export async function securityCode(localSdp: string, remoteSdp: string): Promise<string> {
  const fps = [...sdpFingerprints(localSdp), ...sdpFingerprints(remoteSdp)].sort();
  if (fps.length < 2) throw new Error("Fingerprints fehlen in der SDP");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fps.join("|"))));
  const n = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  const s = String(n % 1_000_000).padStart(6, "0");
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

// ------------------------------------------------------------------ Dateien

export const SAMPLE_EXTENSIONS = ["wav", "aif", "aiff", "mp3", "flac", "mid", "midi"];
/** Grenze im Client: SHA-256 wird im Speicher berechnet. */
export const MAX_SAMPLE_BYTES = 200 * 1024 * 1024;

export function sampleProblem(name: string, size: number): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (!name.includes(".") || !SAMPLE_EXTENSIONS.includes(ext)) return `„${name}“: Dateityp nicht erlaubt (WAV, AIFF, MP3, FLAC, MIDI)`;
  if (size <= 0) return `„${name}“ ist leer`;
  if (size > MAX_SAMPLE_BYTES) return `„${name}“ ist größer als ${MAX_SAMPLE_BYTES / 1024 / 1024} MB`;
  return null;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Binärrahmen auf dem DataChannel "files": [36 Byte ID, ASCII][8 Byte Offset, float64 BE][Daten] */
export const FRAME_HEADER = 44;

export function encodeFrame(id: string, offset: number, data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(FRAME_HEADER + data.byteLength);
  const u8 = new Uint8Array(buf);
  const idBytes = new TextEncoder().encode(id.padEnd(36, " ").slice(0, 36));
  u8.set(idBytes, 0);
  new DataView(buf).setFloat64(36, offset, false);
  u8.set(data, FRAME_HEADER);
  return buf;
}

export function decodeFrame(buf: ArrayBuffer): { id: string; offset: number; data: Uint8Array } | null {
  if (buf.byteLength < FRAME_HEADER) return null;
  const id = new TextDecoder().decode(new Uint8Array(buf, 0, 36)).trim();
  const offset = new DataView(buf).getFloat64(36, false);
  if (!isId(id) || !Number.isSafeInteger(offset) || offset < 0) return null;
  return { id, offset, data: new Uint8Array(buf, FRAME_HEADER) };
}
