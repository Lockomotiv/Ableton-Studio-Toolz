import { useCallback, useEffect, useState } from "react";
import type { AdapterKind, DiagnosticCheck, MetricsSummary, OscErrorEvent, ProbeResult } from "@lom/shared-types";
import { api, errorMessage } from "../api";
import { CheckList } from "../components/CheckList";

export function DiagnosticsPage(props: { adapter: AdapterKind | null }) {
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [running, setRunning] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [errors, setErrors] = useState<OscErrorEvent[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);

  const runAll = useCallback(async () => {
    setRunning(true);
    setFatal(null);
    try {
      setChecks(await api.diagnostics());
      setMetrics(await api.metrics());
      setErrors(await api.errors());
    } catch (e) {
      setFatal(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    void runAll();
  }, [runAll, props.adapter]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Diagnose</h1>
          <p className="muted">
            Alle Ergebnisse stammen aus echten Prüfungen auf diesem Rechner. Nicht durchführbare Prüfungen werden als
            „übersprungen“ markiert.
          </p>
        </div>
        <div className="row">
          <button
            className="btn"
            data-testid="btn-probe"
            onClick={async () => {
              setProbe(await api.probe());
              setMetrics(await api.metrics());
            }}
          >
            Verbindung testen
          </button>
          <button className="btn btn-accent" data-testid="btn-run-diagnostics" disabled={running} onClick={() => void runAll()}>
            {running ? "Prüfe …" : "Diagnose ausführen"}
          </button>
        </div>
      </header>

      {fatal && <div className="banner banner-error">{fatal}</div>}
      {probe && (
        <div className={`banner ${probe.reachable ? "banner-ok" : "banner-error"}`} data-testid="probe-result">
          <strong>/live/test:</strong> {probe.message}
          {probe.roundtripMs != null && <> · gemessene Roundtrip-Zeit {probe.roundtripMs.toFixed(1)} ms</>}
        </div>
      )}

      <section className="grid-2 wide-left">
        <div className="card">
          <div className="card-title">Prüfungen</div>
          {checks ? <CheckList checks={checks} /> : <div className="muted">Prüfe …</div>}
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-title">OSC-Laufzeiten (gemessen)</div>
            {metrics && metrics.count > 0 ? (
              <>
                <table className="kv" data-testid="metrics-table">
                  <tbody>
                    <tr><th>Messungen</th><td>{metrics.count}</td></tr>
                    <tr><th>Minimum</th><td>{metrics.minMs!.toFixed(1)} ms</td></tr>
                    <tr><th>Durchschnitt</th><td>{metrics.avgMs!.toFixed(1)} ms</td></tr>
                    <tr><th>95. Perzentil</th><td>{metrics.p95Ms!.toFixed(1)} ms</td></tr>
                    <tr><th>Maximum</th><td>{metrics.maxMs!.toFixed(1)} ms</td></tr>
                    <tr><th>Timeouts</th><td>{metrics.timeouts}</td></tr>
                  </tbody>
                </table>
                <p className="hint">
                  AbletonOSC verarbeitet Nachrichten einmal pro Live-Tick (~100 ms); Werte zwischen 0 und 100 ms sind
                  daher normal.
                </p>
              </>
            ) : (
              <div className="muted" data-testid="metrics-empty">
                {props.adapter === "mock"
                  ? "Mock-Modus – es werden keine Laufzeiten gemessen."
                  : `Noch keine erfolgreichen Messungen${metrics ? ` (Timeouts: ${metrics.timeouts})` : ""}.`}
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-title">Meldungen von AbletonOSC</div>
            {errors.length === 0 ? (
              <div className="muted">Keine.</div>
            ) : (
              <ul className="log" data-testid="osc-events">
                {errors
                  .slice()
                  .reverse()
                  .map((e, i) => (
                    <li key={i} className={e.level === "error" ? "log-err" : "log-ok"}>
                      <span className="log-icon">{e.level === "error" ? "✘" : "i"}</span>
                      <span className="log-label">{e.message}</span>
                      <span className="log-meta">{new Date(e.atMs).toLocaleTimeString("de-DE")}</span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
