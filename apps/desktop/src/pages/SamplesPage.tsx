import { useCallback, useEffect, useRef, useState } from "react";
import type { ReceivedFile, Settings, TransferInfo } from "@lom/shared-types";
import { SAMPLE_EXTENSIONS } from "@lom/protocol";
import { api, errorMessage } from "../api";
import { useSession } from "../collab/SessionContext";
import type { Transfer } from "../collab/files";

const STATUS: Record<Transfer["status"], string> = {
  hashing: "Prüfsumme wird berechnet …",
  offered: "Angeboten – wartet auf Annahme",
  incoming: "Angebot erhalten",
  sending: "Wird gesendet",
  receiving: "Wird empfangen",
  verifying: "Prüfsumme wird verglichen …",
  done: "Fertig – Prüfsumme identisch",
  rejected: "Abgelehnt",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
  interrupted: "Unterbrochen",
};

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function SamplesPage(props: { settings: Settings; onSettings: (s: Settings) => void }) {
  const { session, snap } = useSession();
  const [info, setInfo] = useState<TransferInfo | null>(null);
  const [received, setReceived] = useState<ReceivedFile[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [folder, setFolder] = useState(props.settings.projectFolder);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const connected = snap?.core.phase === "connected";
  const transfers = snap?.transfers ?? [];
  const doneCount = transfers.filter((t) => t.direction === "in" && t.status === "done").length;

  const reload = useCallback(() => {
    api.transferInfo().then(setInfo).catch((e) => setError(errorMessage(e)));
    api.transferList().then(setReceived).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(reload, [reload, doneCount]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const send = async (files: File[]) => {
    if (!session || !connected) {
      setProblems(["Zum Senden zuerst eine Session verbinden."]);
      return;
    }
    setProblems(await session.files.offer(files));
  };

  const doPreview = async (name: string) => {
    try {
      const buf = await api.transferPreview(name);
      const ext = name.split(".").pop()!.toLowerCase();
      const type = ext === "mp3" ? "audio/mpeg" : ext === "flac" ? "audio/flac" : ext.startsWith("aif") ? "audio/aiff" : "audio/wav";
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ name, url: URL.createObjectURL(new Blob([buf], { type })) });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const importFile = async (name: string) => {
    setError(null);
    setMsg(null);
    try {
      if (folder !== props.settings.projectFolder) props.onSettings(await api.settingsSave({ ...props.settings, projectFolder: folder }));
      const dest = await api.transferImport(name, folder);
      setMsg(`Übernommen nach ${dest} – in Live über den Browser (Places → Projekt) oder per Drag & Drop aus dem Explorer verwenden.`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Samples</h1>
          <p className="muted">Direkter Austausch per Drag &amp; Drop – Ende-zu-Ende verschlüsselt, mit SHA-256-Prüfung</p>
        </div>
      </header>
      {error && <div className="banner banner-error">{error}</div>}
      {msg && <div className="banner banner-ok" data-testid="import-msg">{msg}</div>}

      <div
        className={`dropzone ${over ? "over" : ""} ${connected ? "" : "disabled"}`}
        data-testid="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          void send(Array.from(e.dataTransfer.files));
        }}
        onClick={() => pick.current?.click()}
      >
        <div className="dz-icon">⇪</div>
        <div>
          <strong>{connected ? `Dateien hierher ziehen – gehen direkt an ${snap?.core.peerName ?? "den Partner"}` : "Keine Session verbunden"}</strong>
          <div className="muted">{SAMPLE_EXTENSIONS.map((e) => e.toUpperCase()).join(", ")} · bis 2 GB je Datei · oder klicken zum Auswählen</div>
        </div>
        <input
          ref={pick}
          type="file"
          multiple
          hidden
          accept={SAMPLE_EXTENSIONS.map((e) => "." + e).join(",")}
          data-testid="file-input"
          onChange={(e) => {
            void send(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {problems.map((p, i) => (
        <div key={i} className="banner banner-warn">{p}</div>
      ))}

      <section className="grid-2">
        <div className="card">
          <div className="card-title">Übertragungen</div>
          <ul className="transfers" data-testid="transfers">
            {transfers.length === 0 && <li className="muted">Noch keine.</li>}
            {transfers.map((t) => (
              <li key={t.id} className={`transfer st-${t.status}`} data-testid="transfer" data-status={t.status} data-direction={t.direction}>
                <div className="row-between">
                  <span>
                    {t.direction === "out" ? "↑" : "↓"} <strong>{t.name}</strong> <span className="muted">{fmtBytes(t.size)}</span>
                  </span>
                  <span className="muted">{STATUS[t.status]}</span>
                </div>
                <div className="bar"><div style={{ width: `${(t.done / t.size) * 100}%` }} /></div>
                <div className="row-between small">
                  <span className="muted">
                    {fmtBytes(t.done)} / {fmtBytes(t.size)}
                    {t.resumedFrom ? ` · fortgesetzt ab ${fmtBytes(t.resumedFrom)}` : ""}
                    {t.rateBps ? ` · ${fmtBytes(t.rateBps)}/s gemessen` : ""}
                    {t.savedAs && t.savedAs !== t.name ? ` · gespeichert als ${t.savedAs}` : ""}
                  </span>
                  <span className="row">
                    {t.status === "incoming" && (
                      <>
                        <button className="btn btn-small btn-accent" data-testid="btn-accept" onClick={() => void session?.files.accept(t.id)}>Annehmen</button>
                        <button className="btn btn-small" onClick={() => session?.files.reject(t.id)}>Ablehnen</button>
                      </>
                    )}
                    {["offered", "sending", "receiving"].includes(t.status) && (
                      <button className="btn btn-small" onClick={() => void session?.files.cancel(t.id)}>Abbrechen</button>
                    )}
                    {t.direction === "out" && ["interrupted", "failed"].includes(t.status) && connected && (
                      <button className="btn btn-small" onClick={() => void session?.files.resend(t.id)}>Erneut senden</button>
                    )}
                  </span>
                </div>
                {t.error && <div className="error-text small">{t.error}</div>}
                {t.sha256 && t.status === "done" && <div className="mono small muted">SHA-256 {t.sha256.slice(0, 16)}…</div>}
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="card-title">Empfangen</div>
          <div className="hint">Sicherer Empfangsordner: <span className="mono">{info?.receiveDir ?? "…"}</span> – empfangene Dateien werden nie geöffnet oder ausgeführt.</div>
          <label className="field">
            Ableton-Projektordner (enthält die .als-Datei)
            <input className="input mono" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\Users\…\Music\Mein Track Project" data-testid="project-folder" />
          </label>
          {preview && (
            <div className="preview">
              <span>▶ {preview.name}</span>
              <audio src={preview.url} controls autoPlay />
            </div>
          )}
          <ul className="received" data-testid="received">
            {received.length === 0 && <li className="muted">Noch keine Dateien.</li>}
            {received.map((f) => (
              <li key={f.fileName}>
                <span className="grow">
                  <strong>{f.fileName}</strong> <span className="muted">{fmtBytes(f.size)}</span>
                </span>
                {!/\.midi?$/i.test(f.fileName) && <button className="btn btn-small" onClick={() => void doPreview(f.fileName)}>Anhören</button>}
                <button className="btn btn-small" disabled={!folder.trim()} onClick={() => void importFile(f.fileName)} title="Nach <Projekt>\Samples\Imported\Connect Studio kopieren">
                  Ins Projekt übernehmen
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
