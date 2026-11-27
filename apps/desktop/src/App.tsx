import { useCallback, useEffect, useRef, useState } from "react";
import type { AppInfo, CommandOutcome, DawCommand, LiveStatus, Settings } from "@lom/shared-types";
import { randomHex } from "@lom/protocol";
import { api, errorMessage } from "./api";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { StudioPage } from "./pages/StudioPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { SetupWizard } from "./pages/SetupWizard";
import { SettingsPage } from "./pages/SettingsPage";
import { SessionPage, VideoTile } from "./pages/SessionPage";
import { HubPage } from "./pages/HubPage";
import { SamplesPage } from "./pages/SamplesPage";
import { useSession } from "./collab/SessionContext";

export type Page = "studio" | "session" | "hub" | "samples" | "diagnostics" | "setup" | "settings";

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: "studio", label: "Studio", icon: "◉" },
  { id: "session", label: "Session", icon: "◎" },
  { id: "hub", label: "Projekt-Hub", icon: "▦" },
  { id: "samples", label: "Samples", icon: "⇅" },
  { id: "diagnostics", label: "Diagnose", icon: "✚" },
  { id: "setup", label: "Einrichtung", icon: "➜" },
  { id: "settings", label: "Einstellungen", icon: "⚙" },
];

const POLL_MS = 1000;

export default function App() {
  const [page, setPage] = useState<Page>("studio");
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropMsg, setDropMsg] = useState<string | null>(null);
  const inFlight = useRef(false);
  const { session, snap } = useSession();

  const refreshInfo = useCallback(async () => {
    try {
      setInfo(await api.appInfo());
    } catch (e) {
      setStatusError(errorMessage(e));
    }
  }, []);

  const pollStatus = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setStatus(await api.status());
      setStatusError(null);
    } catch (e) {
      setStatus(null);
      setStatusError(errorMessage(e));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshInfo();
    api
      .settingsGet()
      .then(async (s) => {
        // dauerhafte, zufällige Rechnerkennung für den Hub-Abgleich
        if (!s.siteId) s = await api.settingsSave({ ...s, siteId: randomHex(8) });
        setSettings(s);
        if (!s.setupCompleted) setPage("setup");
      })
      .catch((e) => setStatusError(errorMessage(e)));
  }, [refreshInfo]);

  // Ohne Antwort von Live seltener fragen (spart Timeouts und Last), mit Verbindung jede Sekunde.
  const lastOk = useRef(true);
  useEffect(() => {
    lastOk.current = !statusError;
  }, [statusError]);
  useEffect(() => {
    void pollStatus();
    let ticks = 0;
    const t = setInterval(() => {
      ticks++;
      if (lastOk.current || ticks % 4 === 0) void pollStatus();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [pollStatus]);

  const onAdapterChanged = useCallback(
    async (next: AppInfo) => {
      setInfo(next);
      setStatus(null);
      setStatusError(null);
      await pollStatus();
    },
    [pollStatus],
  );

  // ---- Sitzungsabhängige Studio-Ansicht
  const core = snap?.core;
  const inSession = !!core && core.phase !== "ended" && core.phase !== "idle";
  const guestRemote = inSession && core!.role === "guest" && core!.mode === "remote";
  const hostLocked = inSession && core!.role === "host" && core!.mode === "remote" && core!.control === "guest";

  const execLocal = useCallback(
    async (c: DawCommand): Promise<CommandOutcome> => {
      const o = await api.execute(c);
      session?.core.afterLocalCommand(c);
      return o;
    },
    [session],
  );

  // ---- Globales Drag & Drop: Dateien überall ins Fenster ziehen
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!e.dataTransfer.files.length) return;
    if (!session || core?.phase !== "connected") {
      setDropMsg("Zum Senden von Samples zuerst eine Session verbinden.");
      return;
    }
    const problems = await session.files.offer(Array.from(e.dataTransfer.files));
    setDropMsg(problems.length ? problems.join(" · ") : null);
    setPage("samples");
  };

  return (
    <div
      className="shell"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            ◎
          </div>
          <div>
            <div className="brand-name">LOCK-O-MOTIV</div>
            <div className="brand-sub">Connect Studio</div>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.id}
              data-testid={`nav-${n.id}`}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => setPage(n.id)}
            >
              <span className="nav-icon" aria-hidden>
                {n.icon}
              </span>
              {n.label}
              {n.id === "session" && inSession && <span className={`nav-dot phase-${core!.phase}`} />}
              {n.id === "samples" && snap && snap.transfers.some((t) => t.status === "incoming") && <span className="nav-count">neu</span>}
              {n.id === "session" && core?.controlRequested && core.role === "host" && <span className="nav-count">!</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {inSession && (
            <div className={`badge badge-session phase-${core!.phase}`} data-testid="session-badge">
              <span className="badge-dot" aria-hidden />
              <div>
                <div className="badge-title">{core!.phase === "connected" ? `Session mit ${core!.peerName ?? "…"}` : "Session: warte …"}</div>
                <div className="badge-sub">
                  {core!.mode === "remote" ? "Remote Studio" : "Dual Studio"} · Steuerung:{" "}
                  {core!.control === "host" ? "Host" : core!.control === "shared" ? "gemeinsam" : "Gast"}
                </div>
              </div>
            </div>
          )}
          <ConnectionBadge info={info} status={status} statusError={statusError} />
          <div className="version">
            v{info?.version ?? "…"} · Free Edition · {info?.platform ?? ""}
          </div>
        </div>
      </aside>
      <main className="content">
        {info?.adapterError && (
          <div className="banner banner-error" role="alert">
            {info.adapterError}
          </div>
        )}
        {dropMsg && (
          <div className="banner banner-warn" onClick={() => setDropMsg(null)}>
            {dropMsg}
          </div>
        )}
        {page === "studio" && info && guestRemote && (
          <StudioPage
            title={`Studio von ${session!.invite.hostName}`}
            adapter="abletonOsc"
            status={core!.remoteStatus}
            statusError={core!.remoteStatusError ?? (core!.phase === "connected" ? null : "Nicht mit dem Host verbunden")}
            onChanged={() => {}}
            exec={(c) => session!.core.executeRemote(c)}
            tracksOverride={core!.remoteTracks}
            context={
              <div className="banner banner-ok" data-testid="remote-studio-banner">
                Sie sehen die DAW von <strong>{session!.invite.hostName}</strong>. Alle Befehle laufen über die Session und werden beim Host aus
                Live zurückgelesen.
              </div>
            }
            locked={
              core!.control === "host" ? (
                <>
                  Keine Steuerfreigabe.{" "}
                  <button className="link" onClick={() => session!.core.requestControl()} disabled={core!.controlRequested}>
                    {core!.controlRequested ? "Anfrage gesendet …" : "Steuerung beim Host anfragen"}
                  </button>
                </>
              ) : null
            }
          />
        )}
        {page === "studio" && info && !guestRemote && (
          <StudioPage
            adapter={info.adapter}
            status={status}
            statusError={statusError}
            onChanged={pollStatus}
            exec={execLocal}
            locked={
              hostLocked ? (
                <>
                  <strong>{core!.peerName ?? "Ihr Gast"}</strong> hat die volle Steuerung Ihrer DAW.{" "}
                  <button className="link" data-testid="studio-reclaim" onClick={() => session!.core.setControl("host")}>
                    Steuerung zurückholen
                  </button>
                </>
              ) : null
            }
            context={
              inSession && core!.mode === "dual" ? (
                <div className="banner banner-ok">
                  Dual Studio mit {core!.peerName ?? "Partner"} · Transport-Kopplung {core!.transportLink ? "an" : "aus"} (Session-Seite)
                </div>
              ) : null
            }
          />
        )}
        {page === "session" && settings && info && <SessionPage info={info} settings={settings} onSettings={setSettings} />}
        {page === "hub" && settings && <HubPage settings={settings} onSettings={setSettings} liveStatus={guestRemote ? core!.remoteStatus : status} />}
        {page === "samples" && settings && <SamplesPage settings={settings} onSettings={setSettings} />}
        {page === "diagnostics" && <DiagnosticsPage adapter={info?.adapter ?? null} />}
        {page === "setup" && settings && info && (
          <SetupWizard
            info={info}
            settings={settings}
            onAdapterChanged={onAdapterChanged}
            onDone={(s) => {
              setSettings(s);
              setPage("studio");
            }}
            onSettings={setSettings}
          />
        )}
        {page === "settings" && settings && info && (
          <SettingsPage
            info={info}
            settings={settings}
            onSettings={setSettings}
            onAdapterChanged={onAdapterChanged}
            onRestartSetup={() => setPage("setup")}
          />
        )}
      </main>

      {snap && inSession && page !== "session" && (
        <div className="video-dock" data-testid="video-dock">
          <VideoTile stream={snap.remoteMedia.screen ? snap.remoteScreen : snap.remoteCam} label={core!.peerName ?? "Partner"} off={!snap.remoteCam} />
          <div className="dock-actions">
            <button className={`icon ${snap.mic ? "" : "off"}`} title="Mikrofon" onClick={() => session!.setMic(!snap.mic)}>🎙</button>
            <button className={`icon ${snap.cam ? "" : "off"}`} title="Kamera" onClick={() => session!.setCam(!snap.cam)}>📷</button>
            <button className="icon" title="Zur Session" onClick={() => setPage("session")}>⤢</button>
          </div>
        </div>
      )}

      {dragging && (
        <div className="drop-overlay">
          <div>
            <div className="dz-icon">⇪</div>
            {inSession && core!.phase === "connected" ? `Loslassen, um an ${core!.peerName ?? "den Partner"} zu senden` : "Erst eine Session verbinden"}
          </div>
        </div>
      )}
    </div>
  );
}
