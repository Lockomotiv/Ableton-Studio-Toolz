// Sample-Austausch über den DataChannel "files".
// Steuerung (Angebot/Annahme/Abschluss) läuft über den Kanal "control",
// die Daten als Binärrahmen über "files". Der Sender wartet, wenn der Puffer
// des Datei-Kanals voll ist – dadurch bleiben Steuerbefehle reaktionsschnell.
import {
  decodeFrame, encodeFrame, randomHex, sampleProblem, sha256Blob, type SessionMessage,
} from "@lom/protocol";

export const CHUNK_BYTES = 64 * 1024;

export interface TransferSink {
  begin(id: string, name: string, size: number, sha256: string): Promise<{ fileName: string; resumeOffset: number }>;
  write(id: string, offset: number, data: Uint8Array): Promise<number>;
  finish(id: string): Promise<{ fileName: string; sha256: string; verified: boolean; size: number }>;
  cancel(id: string, keepPartial: boolean): Promise<void>;
}

export interface FileLink {
  sendControl(m: SessionMessage): void;
  /** Sendet einen Rahmen; löst erst auf, wenn wieder Platz im Puffer ist. */
  sendBinary(buf: ArrayBuffer): Promise<void>;
}

export type TransferStatus =
  | "hashing" | "offered" | "incoming" | "sending" | "receiving" | "verifying"
  | "done" | "rejected" | "failed" | "cancelled" | "interrupted";

export interface Transfer {
  id: string;
  direction: "out" | "in";
  name: string;
  size: number;
  done: number;
  status: TransferStatus;
  sha256?: string;
  savedAs?: string;
  error?: string;
  startedMs?: number;
  finishedMs?: number;
  /** gemessene Übertragungsrate in Byte/s (nur abgeschlossene Übertragungen) */
  rateBps?: number;
  resumedFrom?: number;
}

const ACTIVE: TransferStatus[] = ["hashing", "offered", "incoming", "sending", "receiving", "verifying"];

export class FileTransfers {
  private items = new Map<string, Transfer>();
  private files = new Map<string, File>();
  private queues = new Map<string, Promise<unknown>>();
  private cancelled = new Set<string>();
  private listeners = new Set<(t: Transfer[]) => void>();

  constructor(private link: FileLink, private sink: TransferSink, private now: () => number = Date.now) {}

  get list(): Transfer[] {
    return Array.from(this.items.values()).reverse();
  }

  onChange(cb: (t: Transfer[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private upd(id: string, p: Partial<Transfer>) {
    const cur = this.items.get(id);
    if (!cur) return;
    this.items.set(id, { ...cur, ...p });
    const l = this.list;
    this.listeners.forEach((cb) => cb(l));
  }

  private add(t: Transfer) {
    this.items.set(t.id, t);
    const l = this.list;
    this.listeners.forEach((cb) => cb(l));
  }

  /** Dateien anbieten (z. B. per Drag & Drop). Liefert Fehlermeldungen für abgelehnte Dateien. */
  async offer(files: File[]): Promise<string[]> {
    const problems: string[] = [];
    for (const f of files) {
      const p = sampleProblem(f.name, f.size);
      if (p) {
        problems.push(p);
        continue;
      }
      const id = randomHex(12);
      this.files.set(id, f);
      this.add({ id, direction: "out", name: f.name, size: f.size, done: 0, status: "hashing" });
      try {
        // schrittweise: konstanter Speicherbedarf auch bei großen Dateien
        const sha = await sha256Blob(f, 4 * 1024 * 1024, (done) => this.upd(id, { done }));
        this.upd(id, { sha256: sha, status: "offered", done: 0 });
        this.link.sendControl({ t: "file-offer", id, name: f.name, size: f.size, sha256: sha });
      } catch (e) {
        this.upd(id, { status: "failed", error: String(e) });
      }
    }
    return problems;
  }

  /** Unterbrochene/fehlgeschlagene Sendung erneut anbieten (Empfänger setzt fort). */
  async resend(id: string) {
    const f = this.files.get(id);
    if (f) await this.offer([f]);
  }

  async accept(id: string) {
    const t = this.items.get(id);
    if (!t || t.direction !== "in" || t.status !== "incoming") return;
    try {
      const r = await this.sink.begin(id, t.name, t.size, t.sha256!);
      this.upd(id, { status: "receiving", done: r.resumeOffset, resumedFrom: r.resumeOffset || undefined, startedMs: this.now() });
      this.link.sendControl({ t: "file-accept", id, offset: r.resumeOffset });
      if (r.resumeOffset === t.size) await this.complete(id);
    } catch (e) {
      this.upd(id, { status: "failed", error: errMsg(e) });
      this.link.sendControl({ t: "file-reject", id, reason: errMsg(e).slice(0, 400) });
    }
  }

  reject(id: string, reason = "Vom Empfänger abgelehnt") {
    const t = this.items.get(id);
    if (!t || t.status !== "incoming") return;
    this.upd(id, { status: "rejected" });
    this.link.sendControl({ t: "file-reject", id, reason });
  }

  async cancel(id: string) {
    const t = this.items.get(id);
    if (!t || !ACTIVE.includes(t.status)) return;
    this.cancelled.add(id);
    this.upd(id, { status: "cancelled" });
    this.link.sendControl({ t: "file-cancel", id });
    if (t.direction === "in") await this.sink.cancel(id, false).catch(() => {});
  }

  /** Verbindung weg: laufende Übertragungen als unterbrochen markieren, Teil-Downloads behalten. */
  async peerLost() {
    for (const t of this.items.values()) {
      if (!ACTIVE.includes(t.status)) continue;
      this.cancelled.add(t.id);
      this.upd(t.id, { status: "interrupted" });
      if (t.direction === "in" && t.status === "receiving") await this.sink.cancel(t.id, true).catch(() => {});
    }
  }

  async handleControl(m: SessionMessage) {
    switch (m.t) {
      case "file-offer":
        if (this.items.has(m.id)) return;
        this.add({ id: m.id, direction: "in", name: m.name, size: m.size, sha256: m.sha256, done: 0, status: "incoming" });
        return;
      case "file-accept": {
        const t = this.items.get(m.id);
        if (!t || t.direction !== "out" || t.status !== "offered") return;
        if (m.offset > t.size) return;
        void this.stream(m.id, m.offset);
        return;
      }
      case "file-reject":
        this.upd(m.id, { status: "rejected", error: m.reason });
        return;
      case "file-cancel": {
        const t = this.items.get(m.id);
        if (!t || !ACTIVE.includes(t.status)) return;
        this.cancelled.add(m.id);
        this.upd(m.id, { status: "cancelled", error: "Vom Gegenüber abgebrochen" });
        if (t.direction === "in") await this.sink.cancel(m.id, false).catch(() => {});
        return;
      }
      case "file-done": {
        const t = this.items.get(m.id);
        if (!t || t.direction !== "out") return;
        const finishedMs = this.now();
        const ok = m.ok && m.sha256 === t.sha256;
        this.upd(m.id, {
          status: ok ? "done" : "failed",
          finishedMs,
          error: ok ? undefined : m.error ?? "Prüfsumme beim Empfänger abweichend",
          rateBps: t.startedMs ? ((t.size - (t.resumedFrom ?? 0)) * 1000) / Math.max(1, finishedMs - t.startedMs) : undefined,
        });
        return;
      }
    }
  }

  private async stream(id: string, from: number) {
    const f = this.files.get(id);
    const t = this.items.get(id);
    if (!f || !t) return;
    this.upd(id, { status: "sending", done: from, startedMs: this.now(), resumedFrom: from || undefined });
    let off = from;
    try {
      while (off < f.size) {
        if (this.cancelled.has(id)) return;
        const chunk = new Uint8Array(await f.slice(off, off + CHUNK_BYTES).arrayBuffer());
        await this.link.sendBinary(encodeFrame(id, off, chunk));
        off += chunk.byteLength;
        this.upd(id, { done: off });
      }
      this.upd(id, { status: "verifying" });
    } catch (e) {
      if (!this.cancelled.has(id)) this.upd(id, { status: "interrupted", error: errMsg(e) });
    }
  }

  handleBinary(buf: ArrayBuffer) {
    const fr = decodeFrame(buf);
    if (!fr) return;
    const t = this.items.get(fr.id);
    if (!t || t.direction !== "in" || t.status !== "receiving") return;
    // Schreibvorgänge je Übertragung strikt nacheinander
    const data = fr.data.slice();
    const prev = this.queues.get(fr.id) ?? Promise.resolve();
    const next = prev.then(async () => {
      const cur = this.items.get(fr.id);
      if (!cur || cur.status !== "receiving" || this.cancelled.has(fr.id)) return;
      try {
        const written = await this.sink.write(fr.id, fr.offset, data);
        this.upd(fr.id, { done: written });
        if (written === cur.size) await this.complete(fr.id);
      } catch (e) {
        this.cancelled.add(fr.id);
        this.upd(fr.id, { status: "failed", error: errMsg(e) });
        this.link.sendControl({ t: "file-done", id: fr.id, ok: false, error: errMsg(e).slice(0, 400) });
        await this.sink.cancel(fr.id, false).catch(() => {});
      }
    });
    this.queues.set(fr.id, next);
  }

  private async complete(id: string) {
    const t = this.items.get(id)!;
    this.upd(id, { status: "verifying" });
    try {
      const r = await this.sink.finish(id);
      const finishedMs = this.now();
      this.upd(id, {
        status: "done",
        savedAs: r.fileName,
        finishedMs,
        rateBps: t.startedMs ? ((t.size - (t.resumedFrom ?? 0)) * 1000) / Math.max(1, finishedMs - t.startedMs) : undefined,
      });
      this.link.sendControl({ t: "file-done", id, ok: true, sha256: r.sha256 });
    } catch (e) {
      this.upd(id, { status: "failed", error: errMsg(e) });
      this.link.sendControl({ t: "file-done", id, ok: false, error: errMsg(e).slice(0, 400) });
    }
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}
