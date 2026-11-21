import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Settings } from "@lom/shared-types";
import type { HubProject, Invite, SessionMode, SessionRole } from "@lom/protocol";
import { api } from "../api";
import { RtcSession, type RtcSnapshot } from "./rtc";
import type { HubBackend, LocalDaw } from "./core";
import type { TransferSink } from "./files";

export const localDaw: LocalDaw = { execute: api.execute, status: api.status, tracks: api.tracks };

export const hubBackend: HubBackend = {
  ensureProject: async (p) => {
    const existing = (await api.hubProjects()).find((x) => x.id === p.id);
    if (!existing) await api.hubProjectUpsert(p);
  },
  list: api.hubItems,
  merge: api.hubMerge,
};

export const transferSink: TransferSink = {
  begin: (id, name, size, sha) => api.transferBegin(id, name, size, sha),
  write: (id, offset, data) => api.transferWrite(id, offset, data),
  finish: (id) => api.transferFinish(id),
  cancel: (id, keep) => api.transferCancel(id, keep),
};

export function iceFromSettings(s: Settings): RTCIceServer[] {
  const urls = s.extraStun
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => /^stuns?:/.test(x));
  if (s.usePublicStun) urls.push("stun:stun.l.google.com:19302");
  return urls.length ? [{ urls }] : [];
}

interface Ctx {
  session: RtcSession | null;
  snap: RtcSnapshot | null;
  /** Zähler für Hub-Änderungen (lokal oder vom Partner) */
  hubTick: number;
  bumpHub: () => void;
  startSession: (p: { role: SessionRole; mode: SessionMode; invite: Invite; project: HubProject | null; settings: Settings; appVersion: string }) => Promise<void>;
  endSession: () => void;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<RtcSession | null>(null);
  const [snap, setSnap] = useState<RtcSnapshot | null>(null);
  const [hubTick, setHubTick] = useState(0);

  useEffect(() => {
    if (!session) return;
    let lastRev = -1;
    return session.onChange((s) => {
      setSnap(s);
      if (s.core.hubRevision !== lastRev) {
        lastRev = s.core.hubRevision;
        setHubTick((t) => t + 1);
      }
    });
  }, [session]);

  const startSession: Ctx["startSession"] = useCallback(async (p) => {
    const s = new RtcSession({
      role: p.role,
      mode: p.mode,
      name: p.settings.displayName || (p.role === "host" ? "Host" : "Gast"),
      siteId: p.settings.siteId,
      appVersion: p.appVersion,
      project: p.project,
      invite: p.invite,
      extraIce: iceFromSettings(p.settings),
      daw: localDaw,
      hub: hubBackend,
      sink: transferSink,
    });
    setSession(s);
    setSnap(s.snapshot);
    await s.start();
  }, []);

  const endSession = useCallback(() => {
    session?.end();
    if (session?.core.state.role === "host") void api.hostingStop().catch(() => {});
    setSession(null);
    setSnap(null);
  }, [session]);

  const value = useMemo(
    () => ({ session, snap, hubTick, bumpHub: () => setHubTick((t) => t + 1), startSession, endSession }),
    [session, snap, hubTick, startSession, endSession],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): Ctx {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("SessionProvider fehlt");
  return c;
}
