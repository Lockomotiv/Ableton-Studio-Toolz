import { describe, expect, it } from "vitest";
import { ALLOWED_COMMAND_TYPES, describeCommand, formatPan, isAllowedCommandType, validateCommand } from "./index";

describe("Befehls-Allowlist", () => {
  it("entspricht exakt dem Rust-Enum", () => {
    expect([...ALLOWED_COMMAND_TYPES].sort()).toEqual(
      ["continuePlaying", "fireClip", "play", "setLinkEnabled", "setLoop", "setTempo", "setTrackPanning", "setTrackVolume", "stop"].sort(),
    );
  });

  it("lehnt unbekannte Befehle ab", () => {
    expect(isAllowedCommandType("rawOsc")).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validateCommand({ type: "deleteTrack" } as any)).toMatch(/nicht freigegeben/);
  });
});

describe("validateCommand", () => {
  it("prüft Tempo-Grenzen", () => {
    expect(validateCommand({ type: "setTempo", bpm: 120 })).toBeNull();
    expect(validateCommand({ type: "setTempo", bpm: 19 })).not.toBeNull();
    expect(validateCommand({ type: "setTempo", bpm: Number.NaN })).not.toBeNull();
  });
  it("prüft Lautstärke und Panorama", () => {
    expect(validateCommand({ type: "setTrackVolume", track: 0, value: 1 })).toBeNull();
    expect(validateCommand({ type: "setTrackVolume", track: -1, value: 0.5 })).not.toBeNull();
    expect(validateCommand({ type: "setTrackPanning", track: 0, value: -1.2 })).not.toBeNull();
  });
  it("prüft Clip-Indizes", () => {
    expect(validateCommand({ type: "fireClip", track: 0, slot: 2 })).toBeNull();
    expect(validateCommand({ type: "fireClip", track: 0.5, slot: 2 })).not.toBeNull();
  });
});

describe("Beschriftungen", () => {
  it("formatiert Panorama wie Live", () => {
    expect(formatPan(0)).toBe("C");
    expect(formatPan(-1)).toBe("50L");
    expect(formatPan(0.5)).toBe("25R");
  });
  it("beschreibt Befehle 1-basiert", () => {
    expect(describeCommand({ type: "fireClip", track: 0, slot: 0 })).toBe("Clip starten: Spur 1, Slot 1");
  });
});
