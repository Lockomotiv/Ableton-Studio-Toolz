import { useEffect, useState } from "react";
import type { AbletonLocations, Settings } from "@lom/shared-types";
import { api, errorMessage } from "../api";

const SOURCE: Record<string, string> = {
  env: "Umgebungsvariable",
  settings: "von Ihnen gewählt",
  live: "aus Lives Einstellungen (Library.cfg)",
  default: "Windows-Standardort",
  drive: "auf Laufwerk gefunden",
};

/** Zeigt die erkannte Ableton User Library und erlaubt, einen anderen Ordner zu wählen. */
export function UserLibraryPicker(props: { settings: Settings; onSettings: (s: Settings) => void; onChanged?: () => void }) {
  const [loc, setLoc] = useState<AbletonLocations | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState(props.settings.userLibraryPath);
  const [busy, setBusy] = useState(false);

  const reload = () => api.abletonLocations().then(setLoc).catch((e) => setErr(errorMessage(e)));
  useEffect(() => {
    void reload();
  }, [props.settings.userLibraryPath]);

  const save = async (path: string) => {
    setBusy(true);
    setErr(null);
    try {
      const s = await api.settingsSave({ ...props.settings, userLibraryPath: path.trim() });
      props.onSettings(s);
      setManual(s.userLibraryPath);
      props.onChanged?.();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, multiple: false, title: "Ableton User Library wählen", defaultPath: loc?.userLibrary?.path });
      if (typeof dir === "string") await save(dir);
    } catch (e) {
      setErr(`Ordnerauswahl nicht verfügbar: ${errorMessage(e)} – Pfad bitte unten eintragen.`);
    }
  };

  const ul = loc?.userLibrary ?? null;
  const others = (loc?.candidates ?? []).filter((c) => c.exists && c.path !== ul?.path);
  return (
    <div className="userlib" data-testid="userlib">
      {ul ? (
        <div className={`banner ${ul.exists ? "banner-ok" : "banner-warn"}`} data-testid="userlib-current">
          <strong>User Library:</strong> <code>{ul.path}</code> <span className="muted">({SOURCE[ul.source] ?? ul.source})</span>
          {!ul.exists && <> – Ordner existiert nicht.</>}
          {ul.hasAbletonosc && <> – AbletonOSC vorhanden ✔</>}
        </div>
      ) : (
        <div className="banner banner-warn">User Library nicht gefunden – bitte Ordner wählen.</div>
      )}
      {others.length > 0 && (
        <div className="hint">
          Weitere gefundene Orte:{" "}
          {others.map((c) => (
            <button key={c.path} className="link" onClick={() => void save(c.path)} title={SOURCE[c.source]}>
              {c.path}
              {c.hasAbletonosc ? " (mit AbletonOSC)" : ""}
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <button className="btn" onClick={() => void pick()} disabled={busy} data-testid="btn-userlib-pick">
          📁 Ordner wählen …
        </button>
        <input
          className="input mono grow"
          placeholder="z. B. G:\Ableton\User Library"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          data-testid="userlib-input"
        />
        <button className="btn" disabled={busy || manual.trim() === props.settings.userLibraryPath} onClick={() => void save(manual)} data-testid="btn-userlib-save">
          Übernehmen
        </button>
        {props.settings.userLibraryPath && (
          <button className="btn" disabled={busy} onClick={() => void save("")} title="Wieder automatisch erkennen">
            Automatisch
          </button>
        )}
      </div>
      <p className="hint">
        Den Ort zeigt Live unter <em>Optionen → Einstellungen → Library → Speicherort der User Library</em>. Gemeint ist der Ordner
        <code> User Library</code> selbst (darin liegt bzw. entsteht <code>Remote Scripts</code>).
        {loc && loc.installations.length > 0 && <> Live-Programm: <code>{loc.installations[0]}</code>.</>}
      </p>
      {err && <div className="banner banner-error">{err}</div>}
    </div>
  );
}
