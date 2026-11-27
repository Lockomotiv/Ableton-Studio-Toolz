import { describe, expect, it } from "vitest";
import { Sha256, sha256Blob, sha256Hex } from "./index";

const hex = (s: string) => new Sha256().update(new TextEncoder().encode(s)).digestHex();

describe("Inkrementelles SHA-256", () => {
  it("NIST-Testvektoren (FIPS 180-4)", () => {
    expect(hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    const h = new Sha256();
    const a = new Uint8Array(1000).fill(0x61);
    for (let i = 0; i < 1000; i++) h.update(a); // 1 Million "a"
    expect(h.digestHex()).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("stimmt bei beliebiger Blockaufteilung mit WebCrypto überein", async () => {
    const data = Uint8Array.from({ length: 300_001 }, (_, i) => (i * 131 + (i >> 7)) & 255);
    const ref = await sha256Hex(data);
    for (const step of [1, 63, 64, 65, 4096, 99_999]) {
      const h = new Sha256();
      for (let i = 0; i < data.length; i += step) h.update(data.subarray(i, i + step));
      expect(h.digestHex()).toBe(ref);
    }
    expect(await sha256Blob(new Blob([data]), 7777)).toBe(ref);
  });
});
