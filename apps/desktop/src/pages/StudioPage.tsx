import { useCallback, useEffect, useState } from "react";
import type { AdapterKind, CommandOutcome, DawCommand, LiveStatus, TrackInfo } from "@lom/shared-types";
import { describeCommand, formatPan, TEMPO_MAX, TEMPO_MIN } from "@lom/protocol";
import { api, errorMessage } from "../api";

interface LogEntry {
  id: number;
  at: Date;
  label: string;
  outcome?: CommandOutcome;
  error?: string;
}

let logId = 0;

export function StudioPage(props: {
  adapter: AdapterKind;
  status: LiveStatus | null;
  statusError: string | null;
  onChanged: () => Promise<void> | void;
}) {
  const { status, adapter } = props;
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [tempoInput, setTempoInput] = useState("");
  const [clipTrack, setClipTrack] = useState(0);
  const [clipSlot, setClipSlot] = useState(1);

  const run = useCallback(
    async (cmd: DawCommand) => {
      setBusy(true);
      const entry: LogEntry = { id: ++logId, at: new Date(), label: describeCommand(cmd) };
      try {
        entry.outcome = await api.execute(cmd);
      } catch (e) {
        entry.error = errorMessage(e);
      } finally {
        setLog((l) => [entry, ...l].slice(0, 15));
        setBusy(false);
        await props.onChanged();
      }
      return entry;
    },
    [props],
  );

  const loadTracks = useCallback(async () => {
    try {
      setTracks(await api.tracks());
      setTracksError(null);
    } catch (e) {
      setTracks([]);
      setTracksError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void loadTracks();
  }, [loadTracks, adapter, status?.numTracks]);

  const disabled = busy || !status;
  const playing = status?.isPlaying ?? false;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Studio</h1>
          <p className="muted">Lokale Steuerung von Ableton Live über AbletonOSC</p>
        </div>
      </header>

      {adapter === "mock" && (
        <div className="banner banner-warn" data-testid="mock-banner">
          <strong>Mock-Modus:</strong> Es besteht keine Verbindung zu Ableton Live. Alle Werte und Befehle auf dieser
          Seite werden nur simuliert. Unter <em>Einstellungen</em> auf „AbletonOSC“ umschalten.
        </div>
      )}
      {adapter === "abletonOsc" && !status && props.statusError && (
        <div className="banner banner-error" data-testid="status-error">
          {props.statusError}
        </div>
      )}

      <section className="grid-3">
        <div className="card">
          <div className="card-title">Transport</div>
          <div className={`transport-state ${playing ? "is-playing" : ""}`} data-testid="transport-state">
            {status ? (playing ? "▶ Läuft" : "■ Gestoppt") : "—"}
          </div>
          <div className="row">
            <button className="btn btn-play" data-testid="btn-play" disabled={disabled} onClick={() => run({ type: "play" })}>
              ▶ Play
            </button>
            <button className="btn btn-stop" data-testid="btn-stop" disabled={disabled} onClick={() => run({ type: "stop" })}>
              ■ Stop
            </button>
            <button className="btn" disabled={disabled} onClick={() => run({ type: "continuePlaying" })}>
              ⏵ Fortsetzen
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Tempo</div>
          <div className="big-number" data-testid="tempo-value">
            {status ? status.tempo.toFixed(2) : "—"} <span className="unit">BPM</span>
          </div>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const bpm = Number(tempoInput.replace(",", "."));
              void run({ type: "setTempo", bpm });
            }}
          >
            <button
              type="button"
              className="btn"
              disabled={disabled}
              onClick={() => status && run({ type: "setTempo", bpm: Math.max(TEMPO_MIN, Math.round(status.tempo) - 1) })}
            >
              −1
            </button>
            <input
              data-testid="tempo-input"
              className="input"
              inputMode="decimal"
              placeholder={`${TEMPO_MIN}–${TEMPO_MAX}`}
              value={tempoInput}
              onChange={(e) => setTempoInput(e.target.value)}
            />
            <button type="submit" className="btn btn-accent" data-testid="btn-set-tempo" disabled={disabled || !tempoInput}>
              Setzen
            </button>
            <button
              type="button"
              className="btn"
              disabled={disabled}
              onClick={() => status && run({ type: "setTempo", bpm: Math.min(TEMPO_MAX, Math.round(status.tempo) + 1) })}
            >
              +1
            </button>
          </form>
        </div>

        <div className="card">
          <div className="card-title">Loop &amp; Clip</div>
          <div className="row">
            <button
              data-testid="btn-loop"
              className={`btn toggle ${status?.loopEnabled ? "on" : ""}`}
              disabled={disabled}
              onClick={() => status && run({ type: "setLoop", enabled: !status.loopEnabled })}
            >
              ⟲ Loop {status ? (status.loopEnabled ? "an" : "aus") : ""}
            </button>
          </div>
          <div className="row">
            <select className="input" value={clipTrack} onChange={(e) => setClipTrack(Number(e.target.value))}>
              {tracks.map((t) => (
                <option key={t.index} value={t.index}>
                  {t.index + 1}: {t.name}
                </option>
              ))}
            </select>
            <input
              className="input narrow"
              type="number"
              min={1}
              value={clipSlot}
              onChange={(e) => setClipSlot(Math.max(1, Number(e.target.value)))}
              aria-label="Slot"
            />
            <button
              className="btn"
              data-testid="btn-fire-clip"
              disabled={disabled || tracks.length === 0}
              onClick={() => run({ type: "fireClip", track: clipTrack, slot: clipSlot - 1 })}
            >
              Clip starten
            </button>
          </div>
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <div className="card-title row-between">
            <span>Spuren {status ? `(${status.numTracks})` : ""}</span>
            <button className="btn btn-small" onClick={() => void loadTracks()}>
              Neu laden
            </button>
          </div>
          {tracksError && <div className="muted error-text">{tracksError}</div>}
          <table className="tracks" data-testid="tracks-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Lautstärke</th>
                <th>Panorama</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((t) => (
                <TrackRow key={`${adapter}-${t.index}`} track={t} disabled={disabled} run={run} />
              ))}
              {tracks.length === 0 && !tracksError && (
                <tr>
                  <td colSpan={4} className="muted">
                    Keine Spuren geladen.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="hint">
            AbletonOSC liefert nur reguläre Spuren (keine Return-/Master-Spur). Werte werden beim Loslassen des Reglers
            gesendet und anschließend aus Live zurückgelesen.
          </p>
        </div>

        <div className="card">
          <div className="card-title">Befehlsprotokoll</div>
          <ul className="log" data-testid="command-log">
            {log.length === 0 && <li className="muted">Noch keine Befehle.</li>}
            {log.map((e) => (
              <li key={e.id} className={logClass(e)}>
                <span className="log-icon">{logIcon(e)}</span>
                <span className="log-label">{e.label}</span>
                <span className="log-meta">
                  {e.outcome ? `${e.outcome.totalMs.toFixed(1)} ms · ${e.outcome.adapter === "mock" ? "Mock" : "Live"}` : ""}
                </span>
                {(e.error || e.outcome?.note) && <div className="log-note">{e.error ?? e.outcome?.note}</div>}
              </li>
            ))}
          </ul>
          <p className="hint">
            ✔ = Zustand nach dem Befehl aus Live zurückgelesen und bestätigt · ⚠ = gesendet, aber nicht bestätigt · ◌ =
            nur simuliert (Mock) · Zeiten sind gemessen (Befehl + Verifikation).
          </p>
        </div>
      </section>
    </div>
  );
}

function logIcon(e: LogEntry): string {
  if (e.error) return "✘";
  if (e.outcome?.adapter === "mock") return "◌";
  return e.outcome?.verified ? "✔" : "⚠";
}

function logClass(e: LogEntry): string {
  if (e.error) return "log-err";
  if (e.outcome?.adapter === "mock") return "log-mock";
  return e.outcome?.verified ? "log-ok" : "log-warn";
}

function TrackRow(props: { track: TrackInfo; disabled: boolean; run: (c: DawCommand) => Promise<unknown> }) {
  const { track, disabled, run } = props;
  const [vol, setVol] = useState(track.volume);
  const [pan, setPan] = useState(track.panning);
  useEffect(() => setVol(track.volume), [track.volume]);
  useEffect(() => setPan(track.panning), [track.panning]);

  const commitVol = () => vol !== track.volume && void run({ type: "setTrackVolume", track: track.index, value: vol });
  const commitPan = () => pan !== track.panning && void run({ type: "setTrackPanning", track: track.index, value: pan });

  return (
    <tr>
      <td className="muted">{track.index + 1}</td>
      <td>{track.name}</td>
      <td>
        <div className="slider-cell">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={vol}
            disabled={disabled}
            aria-label={`Lautstärke ${track.name}`}
            onChange={(e) => setVol(Number(e.target.value))}
            onPointerUp={commitVol}
            onKeyUp={commitVol}
          />
          <span className="slider-val">{Math.round(vol * 100)}%</span>
        </div>
      </td>
      <td>
        <div className="slider-cell">
          <input
            type="range"
            min={-1}
            max={1}
            step={0.02}
            value={pan}
            disabled={disabled}
            aria-label={`Panorama ${track.name}`}
            onChange={(e) => setPan(Number(e.target.value))}
            onPointerUp={commitPan}
            onKeyUp={commitPan}
          />
          <span className="slider-val">{formatPan(pan)}</span>
        </div>
      </td>
    </tr>
  );
}
