// Spiegel der serde-Typen aus services/daw-bridge/src (camelCase JSON).
// Änderungen MÜSSEN in beiden Dateien erfolgen; der Rust-Test
// `command::tests::json_wire_format_is_stable` und packages/protocol/tests sichern das Format.

export type AdapterKind = "mock" | "abletonOsc";
export type ConnectionState = "unknown" | "connected" | "unreachable" | "simulated";

export interface LiveStatus {
  adapter: AdapterKind;
  connection: ConnectionState;
  liveVersion: string | null;
  isPlaying: boolean;
  tempo: number;
  loopEnabled: boolean;
  numTracks: number;
  /** Ableton Link aktiv; null = nicht abfragbar */
  linkEnabled: boolean | null;
  queryMs: number;
}

export interface TrackInfo {
  index: number;
  name: string;
  volume: number;
  panning: number;
}

export interface ProbeResult {
  adapter: AdapterKind;
  reachable: boolean;
  liveVersion: string | null;
  roundtripMs: number | null;
  message: string;
}

export type DawCommand =
  | { type: "play" }
  | { type: "stop" }
  | { type: "continuePlaying" }
  | { type: "setTempo"; bpm: number }
  | { type: "setLoop"; enabled: boolean }
  | { type: "setTrackVolume"; track: number; value: number }
  | { type: "setTrackPanning"; track: number; value: number }
  | { type: "fireClip"; track: number; slot: number }
  | { type: "setLinkEnabled"; enabled: boolean };

export interface CommandOutcome {
  command: DawCommand;
  adapter: AdapterKind;
  verified: boolean;
  totalMs: number;
  note: string | null;
}

export interface OscErrorEvent {
  atMs: number;
  /** "error" = /live/error, "info" = z. B. /live/startup */
  level: "error" | "info";
  message: string;
}

export interface MetricSample {
  atMs: number;
  address: string;
  roundtripMs: number;
}

export interface MetricsSummary {
  count: number;
  minMs: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  timeouts: number;
  recent: MetricSample[];
}

export type CheckStatus = "pass" | "warn" | "fail" | "skipped";

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  durationMs: number;
}

export type Role = "host" | "guest";
export type StudioMode = "remote" | "dual";

export interface Settings {
  role: Role | null;
  defaultMode: StudioMode | null;
  adapter: AdapterKind;
  setupCompleted: boolean;
  displayName: string;
  siteId: string;
  signalingUrl: string;
  usePublicStun: boolean;
  extraStun: string;
  lanPort: number;
  projectFolder: string;
  activeProjectId: string;
  /** gewählte Ableton User Library; leer = automatisch erkennen */
  userLibraryPath: string;
}

export interface LibraryCandidate {
  path: string;
  /** env | settings | live | default | drive */
  source: string;
  exists: boolean;
  hasAbletonosc: boolean;
}

export interface AbletonLocations {
  userLibrary: LibraryCandidate | null;
  candidates: LibraryCandidate[];
  installations: string[];
  libraryCfgFiles: string[];
}

export interface HostingInfo {
  active: boolean;
  port: number;
  urls: string[];
}

export interface TransferInfo {
  receiveDir: string;
  maxBytes: number;
}

export interface ReceivedFile {
  fileName: string;
  size: number;
  modifiedMs: number;
}

export interface AppInfo {
  version: string;
  platform: string;
  dataDir: string;
  adapter: AdapterKind;
  adapterError: string | null;
  oscSendPort: number;
  oscListenPort: number;
}

/** Fehlerobjekt, das alle Tauri-Kommandos im Fehlerfall liefern. */
export interface CommandError {
  kind: string;
  message: string;
}
