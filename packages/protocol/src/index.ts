// Protokoll-Hilfen für DAW-Befehle (Client-seitig).
// Die verbindliche Prüfung erfolgt in Rust (services/daw-bridge/src/command.rs);
// diese Validierung dient nur der sofortigen Rückmeldung in der Oberfläche.
import type { DawCommand } from "@lom/shared-types";

export const TEMPO_MIN = 20;
export const TEMPO_MAX = 999;

/** Allowlist – identisch mit dem Rust-Enum `DawCommand`. */
export const ALLOWED_COMMAND_TYPES = [
  "play",
  "stop",
  "continuePlaying",
  "setTempo",
  "setLoop",
  "setTrackVolume",
  "setTrackPanning",
  "fireClip",
  "setLinkEnabled",
] as const satisfies readonly DawCommand["type"][];

export function isAllowedCommandType(t: string): t is DawCommand["type"] {
  return (ALLOWED_COMMAND_TYPES as readonly string[]).includes(t);
}

/** Liefert eine deutsche Fehlermeldung oder `null`, wenn der Befehl gültig ist. */
export function validateCommand(c: DawCommand): string | null {
  if (!isAllowedCommandType(c.type)) return `Befehl "${c.type}" ist nicht freigegeben`;
  const finite = (n: number) => typeof n === "number" && Number.isFinite(n);
  const index = (n: number) => Number.isInteger(n) && n >= 0;
  switch (c.type) {
    case "setTempo":
      if (!finite(c.bpm) || c.bpm < TEMPO_MIN || c.bpm > TEMPO_MAX)
        return `BPM muss zwischen ${TEMPO_MIN} und ${TEMPO_MAX} liegen`;
      return null;
    case "setTrackVolume":
      if (!index(c.track)) return "Ungültiger Spurindex";
      if (!finite(c.value) || c.value < 0 || c.value > 1) return "Lautstärke muss zwischen 0 und 1 liegen";
      return null;
    case "setTrackPanning":
      if (!index(c.track)) return "Ungültiger Spurindex";
      if (!finite(c.value) || c.value < -1 || c.value > 1) return "Panorama muss zwischen -1 und 1 liegen";
      return null;
    case "fireClip":
      if (!index(c.track) || !index(c.slot)) return "Ungültiger Spur- oder Slotindex";
      return null;
    default:
      return null;
  }
}

export function describeCommand(c: DawCommand): string {
  switch (c.type) {
    case "play":
      return "Play";
    case "stop":
      return "Stop";
    case "continuePlaying":
      return "Fortsetzen";
    case "setTempo":
      return `Tempo → ${c.bpm.toFixed(2)} BPM`;
    case "setLoop":
      return `Loop ${c.enabled ? "an" : "aus"}`;
    case "setTrackVolume":
      return `Spur ${c.track + 1} Lautstärke → ${Math.round(c.value * 100)} %`;
    case "setTrackPanning":
      return `Spur ${c.track + 1} Panorama → ${formatPan(c.value)}`;
    case "setLinkEnabled":
      return `Ableton Link ${c.enabled ? "an" : "aus"}`;
    case "fireClip":
      return `Clip starten: Spur ${c.track + 1}, Slot ${c.slot + 1}`;
  }
}

export function formatPan(v: number): string {
  if (Math.abs(v) < 0.005) return "C";
  return `${Math.round(Math.abs(v) * 50)}${v < 0 ? "L" : "R"}`;
}

export * from "./hub";
export * from "./session";
