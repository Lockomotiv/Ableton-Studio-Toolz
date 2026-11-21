import { useCallback, useEffect, useRef, useState } from "react";
import type { AppInfo, LiveStatus, Settings } from "@lom/shared-types";
import { api, errorMessage } from "./api";
import { ConnectionBadge } from "./components/ConnectionBadge";
import { StudioPage } from "./pages/StudioPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { SetupWizard } from "./pages/SetupWizard";
import { SettingsPage } from "./pages/SettingsPage";

export type Page = "studio" | "diagnostics" | "setup" | "settings";

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: "studio", label: "Studio", icon: "◉" },
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
  const inFlight = useRef(false);

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
      .then((s) => {
        setSettings(s);
        if (!s.setupCompleted) setPage("setup");
      })
      .catch((e) => setStatusError(errorMessage(e)));
  }, [refreshInfo]);

  useEffect(() => {
    void pollStatus();
    const t = setInterval(() => void pollStatus(), POLL_MS);
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

  return (
    <div className="shell">
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
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
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
        {page === "studio" && info && (
          <StudioPage adapter={info.adapter} status={status} statusError={statusError} onChanged={pollStatus} />
        )}
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
    </div>
  );
}
