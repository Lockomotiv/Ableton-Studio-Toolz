import { describe, expect, it } from "vitest";
import {
  createInvite, createItem, decodeFrame, decodeInvite, editItem, encodeFrame, encodeInvite, isInsecureServer,
  isValidHubItem, maxClock, mergeItems, parseSessionMessage, sampleProblem, securityCode, sdpFingerprints, sha256Hex,
} from "./index";

const ctxA = { author: "Lock", site: "aaaa", clock: 0, now: 1 };

describe("Hub-Abgleich (Last-Writer-Wins)", () => {
  it("führt Offline-Änderungen beider Seiten identisch zusammen", () => {
    const base = createItem({ projectId: "p1", kind: "task", title: "Drums" }, ctxA);
    const onA = editItem(base, { status: "doing" }, { site: "aaaa", clock: 5, now: 2 });
    const onB = editItem(base, { title: "Drums & Groove" }, { site: "bbbb", clock: 5, now: 3 });
    const a = mergeItems(new Map([[base.id, onA]]), [onB]).next;
    const b = mergeItems(new Map([[base.id, onB]]), [onA]).next;
    expect(a.get(base.id)).toEqual(b.get(base.id)); // konvergiert
    expect(a.get(base.id)!.site).toBe("bbbb"); // Gleichstand clock → größere site
  });

  it("Löschen wird nicht durch älteren Stand rückgängig gemacht", () => {
    const it1 = createItem({ projectId: "p1", kind: "note", title: "Idee" }, ctxA);
    const del = editItem(it1, { deleted: true }, { site: "aaaa", clock: it1.clock });
    const { next, applied } = mergeItems(new Map([[it1.id, del]]), [it1]);
    expect(applied).toHaveLength(0);
    expect(next.get(it1.id)!.deleted).toBe(true);
  });

  it("Uhr steigt monoton", () => {
    const i = createItem({ projectId: "p1", kind: "note", title: "x" }, { ...ctxA, clock: 41 });
    expect(i.clock).toBe(42);
    expect(maxClock([i, editItem(i, { title: "y" }, { site: "a", clock: 10 })])).toBe(43);
  });

  it("validiert fremde Einträge", () => {
    const i = createItem({ projectId: "p1", kind: "note", title: "ok" }, ctxA);
    expect(isValidHubItem(i, "p1")).toBe(true);
    expect(isValidHubItem(i, "p2")).toBe(false);
    expect(isValidHubItem({ ...i, status: "hacked" }, "p1")).toBe(false);
    expect(isValidHubItem({ ...i, id: "../../x" }, "p1")).toBe(false);
    expect(isValidHubItem({ ...i, body: "x".repeat(9000) }, "p1")).toBe(false);
  });
});

describe("Sitzungsnachrichten", () => {
  it("akzeptiert gültige und verwirft manipulierte Nachrichten", () => {
    expect(parseSessionMessage(JSON.stringify({ t: "daw-cmd", id: "c1", command: { type: "play" } }))).not.toBeNull();
    expect(parseSessionMessage(JSON.stringify({ t: "daw-cmd", id: "c1", command: { type: "deleteTrack" } }))).toBeNull();
    expect(parseSessionMessage(JSON.stringify({ t: "daw-cmd", id: "c1", command: { type: "setTempo", bpm: 5000 } }))).toBeNull();
    expect(parseSessionMessage(JSON.stringify({ t: "mirror", command: { type: "setTrackVolume", track: 0, value: 1 } }))).toBeNull();
    expect(parseSessionMessage(JSON.stringify({ t: "mirror", command: { type: "setTempo", bpm: 124 } }))).not.toBeNull();
    expect(parseSessionMessage(JSON.stringify({ t: "control", control: "everyone" }))).toBeNull();
    expect(parseSessionMessage(JSON.stringify({ t: "file-offer", id: "f1", name: "a.wav", size: 3, sha256: "00" }))).toBeNull();
    expect(parseSessionMessage("{kaputt")).toBeNull();
    expect(parseSessionMessage(JSON.stringify({ t: "eval", code: "alert(1)" }))).toBeNull();
    expect(parseSessionMessage("x".repeat(600 * 1024))).toBeNull();
  });
});

describe("Einladungen", () => {
  it("Roundtrip und Fehlererkennung", () => {
    const inv = createInvite("wss://signal.example.org", "Lock", "remote");
    expect(inv.token).toHaveLength(48);
    const back = decodeInvite(encodeInvite(inv));
    expect(back).toEqual(inv);
    expect(() => decodeInvite("hallo")).toThrow(/LOM1/);
    expect(() => decodeInvite("LOM1.!!!")).toThrow();
  });
  it("erkennt unverschlüsselte Internet-Server", () => {
    expect(isInsecureServer("ws://192.168.1.20:47870")).toBe(false);
    expect(isInsecureServer("ws://studio.example.org:8787")).toBe(true);
    expect(isInsecureServer("wss://studio.example.org")).toBe(false);
  });
});

describe("Sicherheitscode", () => {
  const sdpA = "v=0\r\na=fingerprint:sha-256 AA:BB:CC\r\n";
  const sdpB = "v=0\r\na=fingerprint:sha-256 11:22:33\r\n";
  it("ist auf beiden Seiten gleich und ändert sich bei fremdem Schlüssel", async () => {
    expect(sdpFingerprints(sdpA)).toEqual(["SHA-256 AA:BB:CC"]);
    const host = await securityCode(sdpA, sdpB);
    const guest = await securityCode(sdpB, sdpA);
    expect(host).toBe(guest);
    expect(host).toMatch(/^\d{3} \d{3}$/);
    const mitm = await securityCode(sdpA, "a=fingerprint:sha-256 EE:EE:EE\r\n");
    expect(mitm).not.toBe(host);
  });
});

describe("Dateien", () => {
  it("prüft Typ und Größe", () => {
    expect(sampleProblem("kick.wav", 10)).toBeNull();
    expect(sampleProblem("Bass.MID", 10)).toBeNull();
    expect(sampleProblem("virus.exe", 10)).toMatch(/nicht erlaubt/);
    expect(sampleProblem("big.wav", 300 * 1024 * 1024)).toMatch(/größer/);
  });
  it("Binärrahmen Roundtrip", async () => {
    const data = new Uint8Array([1, 2, 3, 250]);
    const f = decodeFrame(encodeFrame("abc123", 65536, data))!;
    expect(f.id).toBe("abc123");
    expect(f.offset).toBe(65536);
    expect(Array.from(f.data)).toEqual([1, 2, 3, 250]);
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
