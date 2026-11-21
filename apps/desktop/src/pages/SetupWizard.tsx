import { useState } from "react";
import type { AdapterKind, AppInfo, DiagnosticCheck, ProbeResult, Role, Settings, StudioMode } from "@lom/shared-types";
import { api, errorMessage } from "../api";
import { CheckList } from "../components/CheckList";

interface Step {
  title: string;
  implemented: boolean;
  plannedSprint?: number;
}

const STEPS: Step[] = [
  { title: "Ableton Live erkennen", implemented: true },
  { title: "AbletonOSC prüfen", implemented: true },
  { title: "Lokale OSC-Verbindung testen", implemented: true },
  { title: "Audiointerface & ASIO", implemented: false, plannedSprint: 3 },
  { title: "Kamera & Mikrofon", implemented: false, plannedSprint: 2 },
  { title: "Netzwerk", implemented: false, plannedSprint: 2 },
  { title: "Rolle & Standardmodus", implemented: true },
];

export function SetupWizard(props: {
  info: AppInfo;
  settings: Settings;
  onAdapterChanged: (i: AppInfo) => Promise<void> | void;
  onDone: (s: Settings) => void;
}) {
  const [step, setStep] = useState(0);
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [role, setRole] = useState<Role>(props.settings.role ?? "host");
  const [mode, setMode] = useState<StudioMode>(props.settings.defaultMode ?? "remote");
  const [adapter, setAdapter] = useState<AdapterKind>(props.settings.adapter);

  const diagnose = async () => {
    setBusy(true);
    setError(null);
    try {
      setChecks(await api.diagnostics());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const testOsc = async () => {
    setBusy(true);
    setError(null);
    try {
      const info = await api.setAdapter("abletonOsc");
      await props.onAdapterChanged(info);
      const p = await api.probe();
      setProbe(p);
      if (p.reachable) setAdapter("abletonOsc");
      setChecks(await api.diagnostics());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      const next: Settings = { role, defaultMode: mode, adapter, setupCompleted: true };
      const saved = await api.settingsSave(next);
      const info = await api.setAdapter(adapter);
      await props.onAdapterChanged(info);
      props.onDone(saved);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const s = STEPS[step];
  const go = (i: number) => {
    setStep(i);
    setChecks(null);
    setProbe(null);
    setError(null);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Einrichtung</h1>
          <p className="muted">Einmalige Einrichtung – danach genügt das Öffnen von Connect Studio.</p>
        </div>
      </header>
      <div className="wizard">
        <ol className="steps">
          {STEPS.map((st, i) => (
            <li key={st.title} className={`${i === step ? "current" : ""} ${!st.implemented ? "planned" : ""}`}>
              <button onClick={() => go(i)} data-testid={`wizard-step-${i + 1}`}>
                <span className="step-no">{i + 1}</span>
                <span>
                  {st.title}
                  {!st.implemented && <span className="tag">Sprint {st.plannedSprint}</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div className="card wizard-body">
          <div className="card-title">
            Schritt {step + 1}: {s.title}
          </div>

          {!s.implemented && (
            <div className="banner banner-warn" data-testid="wizard-not-implemented">
              <strong>Noch nicht implementiert.</strong> Dieser Schritt ist für Sprint {s.plannedSprint} geplant und wird
              derzeit nicht geprüft. Sie können ihn überspringen.
            </div>
          )}

          {step === 0 && (
            <>
              <p>Sucht Ableton Live 12 unter den Standard-Installationspfaden und prüft, ob Live gerade läuft.</p>
              <button className="btn btn-accent" onClick={diagnose} disabled={busy}>
                {busy ? "Prüfe …" : "Jetzt prüfen"}
              </button>
              {checks && <CheckList checks={checks} only={["ableton_installed", "ableton_running"]} />}
            </>
          )}

          {step === 1 && (
            <>
              <p>
                Connect Studio steuert Live über das Open-Source-Remote-Script <strong>AbletonOSC</strong> (MIT-Lizenz).
                Es wird <em>nicht</em> automatisch installiert.
              </p>
              <ol className="instructions">
                <li>
                  AbletonOSC herunterladen: <code>https://github.com/ideoforms/AbletonOSC</code> (geprüft mit Commit{" "}
                  <code>0ca6821</code>).
                </li>
                <li>
                  Ordner als <code>AbletonOSC</code> nach{" "}
                  <code>Dokumente\Ableton\User Library\Remote Scripts\</code> kopieren.
                </li>
                <li>
                  Live neu starten → <em>Einstellungen → Link, Tempo &amp; MIDI → Control Surface</em> →{" "}
                  <code>AbletonOSC</code> wählen.
                </li>
                <li>
                  Live zeigt „AbletonOSC: Listening for OSC on port 11000“ in der Statuszeile.
                </li>
              </ol>
              <button className="btn btn-accent" onClick={diagnose} disabled={busy}>
                {busy ? "Prüfe …" : "Installation prüfen"}
              </button>
              {checks && <CheckList checks={checks} only={["abletonosc_installed", "osc_listen_port", "osc_exposure"]} />}
            </>
          )}

          {step === 2 && (
            <>
              <p>
                Schaltet auf den echten AbletonOSC-Adapter um und sendet <code>/live/test</code> an{" "}
                <code>127.0.0.1:{props.info.oscSendPort}</code>. Antworten werden auf{" "}
                <code>127.0.0.1:{props.info.oscListenPort}</code> empfangen.
              </p>
              <button className="btn btn-accent" data-testid="btn-wizard-test-osc" onClick={testOsc} disabled={busy}>
                {busy ? "Teste …" : "Verbindung testen"}
              </button>
              {probe && (
                <div className={`banner ${probe.reachable ? "banner-ok" : "banner-error"}`} data-testid="wizard-probe">
                  {probe.message}
                  {probe.roundtripMs != null && <> · {probe.roundtripMs.toFixed(1)} ms</>}
                </div>
              )}
              {checks && <CheckList checks={checks} only={["osc_roundtrip", "live_version", "osc_api"]} />}
            </>
          )}

          {step === 3 && (
            <p className="muted">
              Geplant: Erkennung des Audiointerfaces, ASIO-Routing und ein Loopback-/Plugin-Pfad für den Ableton-Mix.
            </p>
          )}
          {step === 4 && <p className="muted">Geplant: Auswahl und Test von Kamera und Mikrofon (WebRTC).</p>}
          {step === 5 && <p className="muted">Geplant: LAN-Erkennung, STUN/TURN-Erreichbarkeit und NAT-Typ.</p>}

          {step === 6 && (
            <div className="form">
              <fieldset>
                <legend>Ihre Rolle</legend>
                <label>
                  <input type="radio" checked={role === "host"} onChange={() => setRole("host")} /> Host – Ableton läuft
                  auf diesem Rechner
                </label>
                <label>
                  <input type="radio" checked={role === "guest"} onChange={() => setRole("guest")} /> Gast – verbindet sich
                  mit einem Host
                </label>
              </fieldset>
              <fieldset>
                <legend>Standardmodus</legend>
                <label>
                  <input type="radio" checked={mode === "remote"} onChange={() => setMode("remote")} /> Remote Studio
                </label>
                <label>
                  <input type="radio" checked={mode === "dual"} onChange={() => setMode("dual")} /> Dual Studio
                </label>
              </fieldset>
              <fieldset>
                <legend>DAW-Adapter beim Start</legend>
                <label>
                  <input type="radio" checked={adapter === "abletonOsc"} onChange={() => setAdapter("abletonOsc")} />{" "}
                  AbletonOSC (echte Verbindung)
                </label>
                <label>
                  <input type="radio" checked={adapter === "mock"} onChange={() => setAdapter("mock")} /> Mock (ohne
                  Ableton, nur Simulation)
                </label>
              </fieldset>
              <p className="hint">Gespeichert in der lokalen SQLite-Datenbank: {props.info.dataDir}</p>
            </div>
          )}

          {error && <div className="banner banner-error">{error}</div>}

          <div className="row row-between wizard-nav">
            <button className="btn" disabled={step === 0} onClick={() => go(step - 1)}>
              Zurück
            </button>
            {step < STEPS.length - 1 ? (
              <button className="btn" data-testid="btn-wizard-next" onClick={() => go(step + 1)}>
                {s.implemented ? "Weiter" : "Überspringen"}
              </button>
            ) : (
              <button className="btn btn-accent" data-testid="btn-wizard-finish" disabled={busy} onClick={finish}>
                Einrichtung abschließen
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
