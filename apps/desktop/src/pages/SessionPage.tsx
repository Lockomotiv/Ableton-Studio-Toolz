import { useEffect, useRef, useState } from "react";
import type { AppInfo, Settings } from "@lom/shared-types";
import {
  createInvite, decodeInvite, encodeInvite, inviteExpired, isInsecureServer, newId,
  type ControlMode, type HubProject, type SessionMode,
} from "@lom/protocol";
import { api, errorMessage } from "../api";
import { useSession } from "../collab/SessionContext";
import type { Quality, RtcSnapshot } from "../collab/rtc";

export function VideoTile(props: { stream: MediaStream | null; muted?: boolean; label: string; mirrored?: boolean; testId?: string; off?: boolean; big?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== props.stream) ref.current.srcObject = props.stream;
  }, [props.stream]);
  return (
    <div className={`tile ${props.big ? "tile-big" : ""}`}>
      <video ref={ref} autoPlay playsInline muted={props.muted} data-testid={props.testId} className={props.mirrored ? "mirrored" : ""} />
      {(!props.stream || props.off) && <div className="tile-off">{props.off ? "Kamera aus" : "Kein Bild"}</div>}
      <div className="tile-label">{props.label}</div>
    </div>
  );
}

const PHASE: Record<string, string> = {
  idle: "Bereit",
  waiting: "Warte auf Gast …",
  connecting: "Verbinde …",
  connected: "Verbunden",
  reconnecting: "Verbindung unterbrochen – stelle wieder her …",
  ended: "Beendet",
};

function candidateLabel(t: string | null): string {
  if (t === "host") return "Direkt (lokales Netz)";
  if (t === "srflx" || t === "prflx") return "Direkt über Internet (STUN)";
  if (t === "relay") return "Über TURN-Relay";
  return "–";
}

const fmt = (v: number | null | undefined, unit: string, digits = 0) => (v == null ? "–" : `${v.toFixed(digits)} ${unit}`);

export function SessionPage(props: { info: AppInfo; settings: Settings; onSettings: (s: Settings) => void }) {
  const { session, snap } = useSession();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Session</h1>
          <p className="muted">Gemeinsam produzieren: Video, Sprache, Bildschirm, Steuerung, Samples und Projekt-Hub</p>
        </div>
      </header>
      {session && snap ? <ActiveSession snap={snap} /> : <StartSession {...props} />}
    </div>
  );
}

// ------------------------------------------------------------------ Start

function StartSession(props: { info: AppInfo; settings: Settings; onSettings: (s: Settings) => void }) {
  const { startSession } = useSession();
  const { settings } = props;
  const [mode, setMode] = useState<SessionMode>(settings.defaultMode ?? "remote");
  const [net, setNet] = useState<"lan" | "internet">(settings.signalingUrl ? "internet" : "lan");
  const [projects, setProjects] = useState<HubProject[]>([]);
  const [projectId, setProjectId] = useState(settings.activeProjectId);
  const [newName, setNewName] = useState("");
  const [code, setCode] = useState("");
  const [validHours, setValidHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  useEffect(() => {
    api.hubProjects().then((p) => {
      setProjects(p);
      if (!p.some((x) => x.id === projectId)) setProjectId(p[0]?.id ?? "");
    }).catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const host = async () => {
    setBusy(true);
    setError(null);
    try {
      let project = projects.find((p) => p.id === projectId) ?? null;
      if (!project || newName.trim()) {
        const name = newName.trim() || "Neuer Track";
        project = await api.hubProjectUpsert({ id: newId(), name, createdMs: Date.now() });
      }
      let server: string;
      if (net === "lan") {
        const h = await api.hostingStart(settings.lanPort);
        if (!h.urls.length) throw new Error("Keine LAN-Adresse gefunden – ist dieser Rechner mit einem Netzwerk verbunden?");
        server = h.urls[0];
      } else {
        if (!settings.signalingUrl) throw new Error("Unter Einstellungen zuerst einen Signalisierungsserver eintragen");
        server = settings.signalingUrl;
      }
      const invite = createInvite(server, settings.displayName || "Host", mode, validHours);
      const ownView = net === "lan" ? { ...invite, server: `ws://127.0.0.1:${new URL(server).port}` } : invite;
      props.onSettings(await api.settingsSave({ ...settings, activeProjectId: project.id, defaultMode: mode }));
      // Der Host verbindet sich lokal, der Gast erhält die LAN-/Internet-Adresse.
      await startSession({ role: "host", mode, invite: ownView, project, settings, appVersion: props.info.version });
      sessionStorage.setItem("lom.invite", encodeInvite(invite));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const invite = decodeInvite(code);
      if (inviteExpired(invite)) throw new Error("Diese Einladung ist abgelaufen – bitte beim Host eine neue anfordern.");
      await startSession({ role: "guest", mode: invite.mode, invite, project: null, settings, appVersion: props.info.version });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!settings.displayName && (
        <div className="banner banner-warn">Tipp: Unter <em>Einstellungen</em> einen Anzeigenamen festlegen – er erscheint beim Partner.</div>
      )}
      {error && <div className="banner banner-error" data-testid="session-error">{error}</div>}
      <section className="grid-2">
        <div className="card">
          <div className="card-title">Sitzung hosten</div>
          <div className="form">
            <fieldset>
              <legend>Modus</legend>
              <label>
                <input type="radio" checked={mode === "remote"} onChange={() => setMode("remote")} /> <strong>Remote Studio</strong> – Ableton
                läuft bei mir, der Partner sieht/hört mit und kann die Steuerung erhalten
              </label>
              <label>
                <input type="radio" checked={mode === "dual"} onChange={() => setMode("dual")} /> <strong>Dual Studio</strong> – jeder mit eigenem
                Ableton, Transport/Tempo gekoppelt, Projekte bleiben getrennt
              </label>
            </fieldset>
            <fieldset>
              <legend>Verbindung</legend>
              <label>
                <input type="radio" checked={net === "lan"} onChange={() => setNet("lan")} /> Lokales Netz (eingebauter Server, Port {settings.lanPort})
              </label>
              <label>
                <input type="radio" checked={net === "internet"} onChange={() => setNet("internet")} /> Internet über{" "}
                {settings.signalingUrl ? <code>{settings.signalingUrl}</code> : <em>– kein Server eingetragen –</em>}
              </label>
            </fieldset>
            <label className="field">
              Einladung gültig für
              <select className="input" value={validHours} onChange={(e) => setValidHours(Number(e.target.value))} data-testid="invite-validity">
                <option value={1}>1 Stunde</option>
                <option value={24}>24 Stunden</option>
                <option value={168}>7 Tage</option>
              </select>
            </label>
            <label className="field">
              Projekt im Hub
              <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="host-project">
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                {projects.length === 0 && <option value="">– noch kein Projekt –</option>}
              </select>
            </label>
            <label className="field">
              … oder neues Projekt anlegen
              <input className="input" placeholder="z. B. Sommer-Track 2026" value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="host-new-project" />
            </label>
            <button className="btn btn-accent" data-testid="btn-host" disabled={busy} onClick={host}>
              Sitzung starten &amp; Einladung erzeugen
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Sitzung beitreten</div>
          <div className="form">
            <label className="field">
              Einladungscode vom Host
              <textarea
                className="input code-input"
                rows={4}
                placeholder="LOM1.…"
                value={code}
                data-testid="join-code"
                onChange={(e) => {
                  setCode(e.target.value);
                  try {
                    const inv = decodeInvite(e.target.value);
                    setWarn(isInsecureServer(inv.server) ? `Achtung: ${inv.server} ist unverschlüsselt (ws://) und liegt nicht im lokalen Netz. Die Medien bleiben Ende-zu-Ende verschlüsselt, der Verbindungsaufbau jedoch nicht.` : null);
                  } catch {
                    setWarn(null);
                  }
                }}
              />
            </label>
            {warn && <div className="banner banner-warn">{warn}</div>}
            <button className="btn btn-accent" data-testid="btn-join" disabled={busy || !code.trim()} onClick={join}>
              Beitreten
            </button>
            <p className="hint">
              Der Code enthält Serveradresse, Raum und ein einmaliges Geheimnis. Nur über einen vertraulichen Weg weitergeben
              (z. B. Messenger). Kamera und Mikrofon werden erst beim Beitreten angefragt.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ Aktive Sitzung

function ActiveSession({ snap }: { snap: RtcSnapshot }) {
  const { session, endSession } = useSession();
  const core = snap.core;
  const isHost = core.role === "host";
  const [copied, setCopied] = useState(false);
  const [screenErr, setScreenErr] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const invite = isHost ? sessionStorage.getItem("lom.invite") : null;

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then(setDevices).catch(() => {});
  }, [snap.localStream]);

  if (!session) return null;
  const connected = core.phase === "connected";
  const remoteName = core.peerName ?? (isHost ? "Gast" : session.invite.hostName);
  const showScreen = snap.remoteMedia.screen && snap.remoteScreen;

  return (
    <>
      <div className={`session-bar phase-${core.phase}`} data-testid="session-phase" data-phase={core.phase}>
        <span className="dot" />
        <strong>{PHASE[core.phase]}</strong>
        <span className="muted">
          {isHost ? "Sie hosten" : `Gast bei ${session.invite.hostName}`} · {core.mode === "remote" ? "Remote Studio" : "Dual Studio"}
          {core.project ? ` · Projekt „${core.project.name}“` : ""}
          {core.peerName ? ` · Partner: ${core.peerName}` : ""}
        </span>
        <span className="spacer" />
        {snap.securityCode && (
          <span className="seccode" title="Beide Seiten müssen denselben Code sehen. Abweichung = jemand sitzt dazwischen." data-testid="security-code">
            Sicherheitscode <strong>{snap.securityCode}</strong>
          </span>
        )}
        <button className="btn btn-danger" data-testid="btn-end-session" onClick={endSession}>
          Sitzung beenden
        </button>
      </div>

      {snap.signalingError && <div className="banner banner-error">{snap.signalingError}</div>}
      {snap.mediaError && <div className="banner banner-warn">{snap.mediaError}</div>}

      {isHost && invite && !connected && (
        <div className="card invite">
          <div className="card-title">Einladung für Ihren Partner</div>
          <code className="invite-code" data-testid="invite-code">{invite}</code>
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(invite).then(() => setCopied(true));
              }}
            >
              {copied ? "Kopiert ✔" : "Code kopieren"}
            </button>
            <span className="hint">
              Server: {decodeInvite(invite).server}
              {decodeInvite(invite).expiresAt ? ` · gültig bis ${new Date(decodeInvite(invite).expiresAt! * 1000).toLocaleString("de-DE")}` : ""}
            </span>
          </div>
        </div>
      )}

      <section className="session-grid">
        <div className="stack">
          <div className={`videos ${showScreen ? "with-screen" : ""}`}>
            {showScreen && (
              <VideoTile stream={snap.remoteScreen} label={`Bildschirm von ${remoteName}${snap.remoteMedia.screenAudio ? " · mit DAW-/Systemton" : ""}`} big testId="video-remote-screen" />
            )}
            <VideoTile stream={snap.remoteCam} label={`${remoteName}${snap.remoteMedia.mic ? "" : " · stumm"}`} off={connected && !snap.remoteMedia.cam} big={!showScreen} testId="video-remote" />
            <VideoTile stream={snap.localStream} muted mirrored label={`Ich${snap.mic ? "" : " · stumm"}`} off={!snap.cam} testId="video-local" />
          </div>
          <div className="card">
            <div className="row">
              <button className={`btn toggle ${snap.mic ? "on" : ""}`} data-testid="btn-mic" onClick={() => session.setMic(!snap.mic)}>
                {snap.mic ? "🎙 Mikrofon an" : "🎙 Mikrofon aus"}
              </button>
              <button className={`btn toggle ${snap.cam ? "on" : ""}`} data-testid="btn-cam" onClick={() => session.setCam(!snap.cam)}>
                {snap.cam ? "📷 Kamera an" : "📷 Kamera aus"}
              </button>
              {snap.screenStream ? (
                <button className="btn toggle on" onClick={() => session.stopScreen()}>🖥 Freigabe beenden</button>
              ) : (
                <>
                  <button className="btn" onClick={() => session.shareScreen(false).catch((e) => setScreenErr(errorMessage(e)))}>🖥 Bildschirm teilen</button>
                  <button
                    className="btn"
                    title="Bildschirm inkl. Systemton – überträgt den Ableton-Mix getrennt vom Mikrofon"
                    onClick={() => session.shareScreen(true).catch((e) => setScreenErr(errorMessage(e)))}
                  >
                    🖥🔊 Bildschirm + DAW-Ton
                  </button>
                </>
              )}
              <select className="input" value={snap.quality} onChange={(e) => void session.setQuality(e.target.value as Quality)} title="Videoqualität">
                <option value="auto">Qualität: automatisch</option>
                <option value="low">Niedrig (300 kbit/s)</option>
                <option value="medium">Mittel (1 Mbit/s)</option>
                <option value="high">Hoch (2,5 Mbit/s)</option>
              </select>
            </div>
            <div className="row">
              <select
                className="input"
                aria-label="Mikrofon"
                onChange={(e) => void session.startLocalMedia({ audioId: e.target.value || undefined })}
              >
                <option value="">Mikrofon: Standard</option>
                {devices.filter((d) => d.kind === "audioinput").map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || "Mikrofon"}</option>
                ))}
              </select>
              <select className="input" aria-label="Kamera" onChange={(e) => void session.startLocalMedia({ videoId: e.target.value || undefined })}>
                <option value="">Kamera: Standard</option>
                {devices.filter((d) => d.kind === "videoinput").map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || "Kamera"}</option>
                ))}
              </select>
            </div>
            {screenErr && <div className="muted error-text">{screenErr}</div>}
            <p className="hint">
              Bitte Kopfhörer verwenden. „Bildschirm + DAW-Ton“ sendet den Systemton (Ableton-Mix) auf einer eigenen Spur – das Mikrofon
              wird nicht doppelt übertragen, solange es nicht zusätzlich über Live geroutet wird.
            </p>
          </div>
        </div>

        <div className="stack">
          <ControlCard snap={snap} />
          <NetCard snap={snap} />
          <div className="card">
            <div className="card-title">Ereignisse</div>
            <ul className="log" data-testid="session-events">
              {core.events.length === 0 && <li className="muted">Noch keine.</li>}
              {core.events.slice(0, 30).map((e, i) => (
                <li key={i} className={e.level === "error" ? "log-err" : e.level === "warn" ? "log-warn" : "log-ok"}>
                  <span className="log-icon">{e.level === "info" ? "•" : "!"}</span>
                  <span className="log-label">{e.text}</span>
                  <span className="log-meta">{new Date(e.at).toLocaleTimeString("de-DE")}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}

function ControlCard({ snap }: { snap: RtcSnapshot }) {
  const { session } = useSession();
  if (!session) return null;
  const core = snap.core;
  const connected = core.phase === "connected";

  if (core.mode === "dual") {
    return (
      <div className="card">
        <div className="card-title">Dual Studio – Transport koppeln</div>
        <label className="switch">
          <input type="checkbox" checked={core.transportLink} onChange={(e) => session.core.setTransportLink(e.target.checked)} data-testid="transport-link" />
          Play/Stop, Tempo und Loop mit dem Partner koppeln
        </label>
        <p className="hint">
          Gekoppelte Befehle führt jedes Studio in der eigenen Ableton-Instanz aus – nur wenn beide die Kopplung eingeschaltet haben.
          Projekte, Spuren und Mixer werden nie verändert. Über das Internet ist das nicht sample-genau (Netzwerklatenz); im selben LAN
          für exakte Synchronisation <strong>Ableton Link</strong> aktivieren (Studio-Seite).
        </p>
      </div>
    );
  }

  if (core.role === "host") {
    const opts: { v: ControlMode; label: string; sub: string }[] = [
      { v: "host", label: "Nur ich", sub: "Gast sieht und hört nur zu" },
      { v: "shared", label: "Gemeinsam", sub: "beide dürfen Transport, Tempo, Mixer und Clips steuern" },
      { v: "guest", label: "Komplett übergeben", sub: "nur der Gast steuert; Sie können jederzeit zurückholen" },
    ];
    return (
      <div className="card">
        <div className="card-title">Steuerung meiner DAW</div>
        {core.controlRequested && (
          <div className="banner banner-warn" data-testid="control-request">
            <strong>{core.peerName ?? "Gast"}</strong> möchte die Steuerung.
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-accent" data-testid="btn-grant-shared" onClick={() => session.core.answerRequest(true, "shared")}>Gemeinsam steuern</button>
              <button className="btn" data-testid="btn-grant-full" onClick={() => session.core.answerRequest(true, "guest")}>Komplett übergeben</button>
              <button className="btn" onClick={() => session.core.answerRequest(false)}>Ablehnen</button>
            </div>
          </div>
        )}
        <div className="choices">
          {opts.map((o) => (
            <label key={o.v} className={`choice ${core.control === o.v ? "on" : ""}`}>
              <input
                type="radio"
                name="control"
                checked={core.control === o.v}
                disabled={!connected && o.v !== "host"}
                onChange={() => session.core.setControl(o.v)}
                data-testid={`control-${o.v}`}
              />
              <span>
                <strong>{o.label}</strong>
                <br />
                <span className="muted">{o.sub}</span>
              </span>
            </label>
          ))}
        </div>
        {core.control !== "host" && (
          <button className="btn btn-danger" data-testid="btn-reclaim" onClick={() => session.core.setControl("host")}>
            Steuerung sofort zurückholen
          </button>
        )}
        <p className="hint">
          Freigegeben werden nur die Befehle aus der Allowlist (Transport, Tempo, Loop, Link, Lautstärke, Panorama, Clip starten) – keine
          Maus/Tastatur, keine Dateien, kein Löschen. Bei Verbindungsabbruch fällt die Steuerung automatisch an Sie zurück.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">Steuerung der Host-DAW</div>
      <div className={`control-state control-${core.control}`} data-testid="guest-control" data-control={core.control}>
        {core.control === "host" ? "Nur zuhören – keine Steuerfreigabe" : core.control === "shared" ? "Sie steuern gemeinsam mit dem Host" : "Sie haben die volle Steuerung"}
      </div>
      {core.control === "host" ? (
        <button className="btn btn-accent" data-testid="btn-request-control" disabled={!connected || core.controlRequested} onClick={() => session.core.requestControl()}>
          {core.controlRequested ? "Anfrage gesendet …" : "Steuerung anfragen"}
        </button>
      ) : (
        <button className="btn" onClick={() => session.core.releaseControl()}>Steuerung zurückgeben</button>
      )}
      <p className="hint">Gesteuert wird auf der Seite <em>Studio</em>; alle Befehle laufen über den Host und werden dort aus Live zurückgelesen.</p>
    </div>
  );
}

function NetCard({ snap }: { snap: RtcSnapshot }) {
  const st = snap.stats;
  return (
    <div className="card">
      <div className="card-title">Verbindung (gemessen)</div>
      <table className="kv" data-testid="net-stats">
        <tbody>
          <tr><th>Weg</th><td>{candidateLabel(st?.candidateType ?? null)}</td></tr>
          <tr><th>Verbindungsaufbau</th><td>{fmt(snap.setupMs, "ms")}</td></tr>
          <tr><th>Netzwerk-RTT</th><td>{fmt(st?.rttMs, "ms", 1)}</td></tr>
          <tr><th>Steuerkanal-RTT</th><td>{fmt(snap.core.controlRttMs, "ms")}</td></tr>
          <tr><th>Jitter Audio / Video</th><td>{fmt(st?.audioJitterMs, "ms", 1)} / {fmt(st?.videoJitterMs, "ms", 1)}</td></tr>
          <tr><th>Paketverlust</th><td>{fmt(st?.packetLossPct, "%", 2)}</td></tr>
          <tr><th>Empfang / Senden</th><td>{fmt(st?.inKbps, "kbit/s")} / {fmt(st?.outKbps, "kbit/s")}</td></tr>
          <tr><th>Verfügbar (Senden)</th><td>{fmt(st?.availableOutKbps, "kbit/s")}</td></tr>
        </tbody>
      </table>
      <p className="hint">Werte aus WebRTC-getStats(), alle 2 s; „–“ = noch nicht gemessen. Medien laufen Ende-zu-Ende verschlüsselt (DTLS-SRTP).</p>
    </div>
  );
}
