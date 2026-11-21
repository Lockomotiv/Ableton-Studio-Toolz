import { useState } from "react";
import type { AdapterKind, AppInfo, Settings } from "@lom/shared-types";
import { api, errorMessage } from "../api";

export function SettingsPage(props: {
  info: AppInfo;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onAdapterChanged: (i: AppInfo) => Promise<void> | void;
  onRestartSetup: () => void;
}) {
  const { info, settings } = props;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const switchAdapter = async (kind: AdapterKind) => {
    setBusy(true);
    setError(null);
    try {
      await props.onAdapterChanged(await api.setAdapter(kind));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (patch: Partial<Settings>) => {
    try {
      props.onSettings(await api.settingsSave({ ...settings, ...patch }));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Einstellungen</h1>
          <p className="muted">Lokale Konfiguration dieses Rechners</p>
        </div>
      </header>
      {error && <div className="banner banner-error" data-testid="settings-error">{error}</div>}

      <CollabSettings settings={settings} save={save} />

      <section className="grid-2">
        <div className="card">
          <div className="card-title">DAW-Adapter (aktuelle Sitzung)</div>
          <div className="segmented">
            <button
              data-testid="adapter-mock"
              className={info.adapter === "mock" ? "on" : ""}
              disabled={busy}
              onClick={() => switchAdapter("mock")}
            >
              Mock
            </button>
            <button
              data-testid="adapter-osc"
              className={info.adapter === "abletonOsc" ? "on" : ""}
              disabled={busy}
              onClick={() => switchAdapter("abletonOsc")}
            >
              AbletonOSC
            </button>
          </div>
          <p className="hint">
            Der Adapter beim Programmstart wird gespeichert:{" "}
            <strong>{settings.adapter === "mock" ? "Mock" : "AbletonOSC"}</strong>.{" "}
            {settings.adapter !== info.adapter && (
              <button className="link" onClick={() => save({ adapter: info.adapter })}>
                Aktuelle Auswahl als Standard speichern
              </button>
            )}
          </p>
          <table className="kv">
            <tbody>
              <tr><th>AbletonOSC-Ziel</th><td>127.0.0.1:{info.oscSendPort} (UDP)</td></tr>
              <tr><th>Antwortport</th><td>127.0.0.1:{info.oscListenPort} (UDP)</td></tr>
              <tr><th>Netzwerk</th><td>ausschließlich Loopback, nicht konfigurierbar</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">Profil</div>
          <div className="form">
            <label className="field">
              Rolle
              <select
                className="input"
                value={settings.role ?? ""}
                onChange={(e) => save({ role: (e.target.value || null) as Settings["role"] })}
              >
                <option value="">– nicht gewählt –</option>
                <option value="host">Host</option>
                <option value="guest">Gast</option>
              </select>
            </label>
            <label className="field">
              Standardmodus
              <select
                className="input"
                value={settings.defaultMode ?? ""}
                onChange={(e) => save({ defaultMode: (e.target.value || null) as Settings["defaultMode"] })}
              >
                <option value="">– nicht gewählt –</option>
                <option value="remote">Remote Studio</option>
                <option value="dual">Dual Studio</option>
              </select>
            </label>
            {saved && <span className="muted">Gespeichert.</span>}
          </div>
          <table className="kv">
            <tbody>
              <tr><th>Version</th><td>{info.version}</td></tr>
              <tr><th>Plattform</th><td>{info.platform}</td></tr>
              <tr><th>Datenordner</th><td className="mono">{info.dataDir}</td></tr>
            </tbody>
          </table>
          <button className="btn" onClick={props.onRestartSetup}>
            Einrichtungsassistent erneut öffnen
          </button>
        </div>
      </section>
    </div>
  );
}

function CollabSettings(props: { settings: Settings; save: (p: Partial<Settings>) => Promise<void> }) {
  const [d, setD] = useState(props.settings);
  const dirty = JSON.stringify(d) !== JSON.stringify(props.settings);
  const urlOk = !d.signalingUrl || /^wss?:\/\/[^\s]+$/.test(d.signalingUrl);
  return (
    <section className="card">
      <div className="card-title">Zusammenarbeit</div>
      <div className="grid-2 tight">
        <div className="form">
          <label className="field">
            Anzeigename
            <input className="input" maxLength={64} value={d.displayName} onChange={(e) => setD({ ...d, displayName: e.target.value })} data-testid="set-name" />
          </label>
          <label className="field">
            Signalisierungsserver für Internet-Sessions (eigener Server, siehe docs/deployment)
            <input className="input mono" placeholder="wss://signal.mein-studio.de" value={d.signalingUrl} onChange={(e) => setD({ ...d, signalingUrl: e.target.value.trim() })} />
          </label>
          {!urlOk && <div className="error-text small">Muss mit ws:// oder wss:// beginnen.</div>}
          <label className="field">
            LAN-Port (eingebauter Server)
            <input className="input narrow" type="number" min={1024} max={65535} value={d.lanPort} onChange={(e) => setD({ ...d, lanPort: Number(e.target.value) })} />
          </label>
        </div>
        <div className="form">
          <label className="switch">
            <input type="checkbox" checked={d.usePublicStun} onChange={(e) => setD({ ...d, usePublicStun: e.target.checked })} />
            Öffentlichen STUN-Server von Google verwenden (hilft beim Verbindungsaufbau durch Router; übermittelt Ihre öffentliche IP an Google)
          </label>
          <label className="field">
            Weitere STUN-Server (eine URL je Zeile, z. B. stun:turn.mein-studio.de:3478)
            <textarea className="input mono" rows={3} value={d.extraStun} onChange={(e) => setD({ ...d, extraStun: e.target.value })} />
          </label>
          <p className="hint">TURN-Zugangsdaten werden nicht hier gespeichert – Ihr Signalisierungsserver stellt zeitlich begrenzte Zugangsdaten aus.</p>
        </div>
      </div>
      <div className="row">
        <button className="btn btn-accent" disabled={!dirty || !urlOk || d.lanPort < 1024 || d.lanPort > 65535} onClick={() => void props.save(d)} data-testid="btn-save-collab">
          Speichern
        </button>
      </div>
    </section>
  );
}
