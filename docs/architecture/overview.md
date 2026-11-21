# Architektur (Stand Sprint 1)

```
┌──────────────────────────── Connect Studio (Tauri 2) ─────────────────────────────┐
│  WebView (React + TypeScript)                                                     │
│   Studio · Diagnose · Einrichtung · Einstellungen                                 │
│        │  invoke("daw_execute", {command})  – nur Typen aus @lom/shared-types      │
│        ▼                                                                          │
│  Rust-Backend (apps/desktop/src-tauri)                                            │
│   AppState: aktiver Adapter (Mock | AbletonOSC), Befehls-Mutex (strikte           │
│   Reihenfolge), SQLite-Einstellungen, JSONL-Befehlsprotokoll                      │
│        │                                                                          │
│        ▼                                                                          │
│  lom-daw-bridge (services/daw-bridge)                                             │
│   trait DawAdapter ── MockAdapter (In-Memory, als Mock gekennzeichnet)            │
│                   └─ AbletonOscAdapter ── UDP 127.0.0.1:11001 ◄─┐                 │
│   DawCommand = Allowlist   diagnostics   metrics (gemessen)     │                 │
└─────────────────────────────────────────────────────────────────┼─────────────────┘
                                         UDP 127.0.0.1:11000      │ Antworten
                                                   ▼              │
                                     Ableton Live 12 + AbletonOSC ┘
```

## Grundsätze

* **Allowlist statt Durchreichen:** Das Frontend (und später Remote-Teilnehmer) kann nur Varianten von
  `DawCommand` senden. Es gibt keinen generischen OSC-Befehl. Unbekannte Befehlstypen scheitern
  bereits beim Deserialisieren (Test `unknown_command_is_rejected_by_deserializer`).
* **Nichts vortäuschen:** Verbindungsstatus „verbunden“ nur nach einer echten Antwort.
  Befehle werden nach dem Senden aus Live zurückgelesen (`verified`). Mock-Antworten tragen
  `adapter: "mock"` und `connection: "simulated"`; die Oberfläche zeigt dann dauerhaft „MOCK-MODUS“.
  Laufzeiten werden mit `Instant` um echte UDP-Roundtrips gemessen; der Mock meldet keine.
* **Nur Loopback:** Der Adapter bindet `127.0.0.1` und sendet an `127.0.0.1`; ein anderer Host ist nicht
  konfigurierbar. Pakete von Nicht-Loopback-Adressen werden verworfen.
* **Geordnete Ausführung:** `daw_execute` hält einen asynchronen Mutex – Befehle laufen strikt
  nacheinander in Eingangsreihenfolge.
* **Robust gegen Abbrüche:** Timeouts setzen den Zustand auf `unreachable`; der Empfangs-Task läuft weiter,
  sodass die Verbindung nach einem Neustart von Live ohne Neustart des Clients zurückkehrt
  (Test `connection_loss_and_recovery`). Unter Windows wird `WSAECONNRESET` nach ICMP „port unreachable“
  toleriert.

## Verzeichnisse

| Pfad | Inhalt | Status |
|---|---|---|
| `apps/desktop` | Tauri-App (React-Frontend + Rust-Backend) | Sprint 1 ✔ |
| `services/daw-bridge` | DAW-Adapter, Allowlist, Diagnose, Messwerte | Sprint 1 ✔ |
| `packages/shared-types` | TS-Spiegel der Rust-Typen | Sprint 1 ✔ |
| `packages/protocol` | Client-Validierung, Beschriftungen | Sprint 1 ✔ |
| `services/signaling`, `media`, `transfer` | Sitzungen, WebRTC, Sample Exchange | Sprint 2–3 (leer) |
| `crates/windows-audio`, `crates/remote-input` | Audio-Capture, Fernsteuerung | Sprint 3–4 (leer) |
| `installer` | NSIS über Tauri-Bundler | CI-Build, ungetestet |

## Laufzeitdaten

* Einstellungen: `%APPDATA%\de.lockomotiv.connectstudio\settings.sqlite` (überschreibbar mit `LOM_DATA_DIR`)
* Befehlsprotokoll: `…\logs\daw-commands.jsonl` (jeder Befehl mit gemessener Dauer und Verifikation)
* Umgebungsvariablen für Tests/Fehlersuche: `LOM_ADAPTER=mock|abletonOsc`, `LOM_OSC_SEND_PORT`,
  `LOM_OSC_LISTEN_PORT`, `LOM_ABLETON_USER_LIBRARY`
