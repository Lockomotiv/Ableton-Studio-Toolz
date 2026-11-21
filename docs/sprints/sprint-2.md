# Sprint 2 – Online-Zusammenarbeit

**Stand:** 0.2.0 · Branch `claude/lock-o-motiv-sprint-1-g49atg`
**Schwerpunkt (Auftrag):** gemeinsam ein Projekt steuern und produzieren, Samples per Drag & Drop, Steuerung komplett übergeben,
Videoübertragung, gemeinsamer Hub für Notizen und Planer; lokal über Ableton Link.

## Umgesetzt

| Bereich | Inhalt |
|---|---|
| **Signalisierung** (`services/signaling`) | Selbst betreibbarer WebSocket-Dienst (Rust): Räume, Einladungsgeheimnis (nur Hash gespeichert), max. 2 Teilnehmer, 64-KiB-Grenze, TURN-Zugangsdaten nach coturn-Schema (Geheimnis bleibt auf dem Server). Eingebettet in die App für LAN-Sessions; Docker-Compose mit Caddy (TLS) + coturn für Internet-Sessions. |
| **Session** (`apps/desktop/src/collab`) | WebRTC mit festen Transceivern: Mikrofon, Kamera, Bildschirm, Systemton/DAW-Mix (getrennt vom Mikrofon). DataChannels „control“ (Vorrang) und „files“ (mit Gegendruck). Einladungscodes `LOM1.…`, Sicherheitscode aus beiden DTLS-Fingerprints, automatische Wiederverbindung, gemessene Netzwerkwerte. |
| **Gemeinsame Steuerung** | Remote Studio: Gast steuert die Host-DAW über die Allowlist; Host wählt *Nur ich / Gemeinsam / Komplett übergeben*; Gast kann anfragen und zurückgeben; Host kann immer zurückholen; Abbruch → sofort Host-only. Host-seitige Prüfung jeder Nachricht, Ratenbegrenzung. Host sendet seinen Live-Status jede Sekunde an den Gast. |
| **Dual Studio** | Jeder steuert die eigene DAW; Play/Stop/Fortsetzen/Tempo/Loop werden gespiegelt, wenn beide die Kopplung eingeschaltet haben. Spuren/Mixer werden nie gespiegelt (keine Projektüberschreibung). |
| **Ableton Link** | Schalter im Studio (`/live/song/set/is_ableton_link_enabled`, gegen AbletonOSC-Code verifiziert) für sample-genaue Synchronisation im LAN. |
| **Sample Exchange** | Drag & Drop überall im Fenster oder auf die Dropzone; nur WAV/AIFF/MP3/FLAC/MIDI; SHA-256 beim Sender, Neuberechnung beim Empfänger; ausdrückliche Annahme; Wiederaufnahme nach Abbruch; sicherer Empfangsordner (Name bereinigt, kein Überschreiben, nichts wird geöffnet); Vorschau; „Ins Projekt übernehmen“ nur in Ordner mit `.als`. Rust-Speicher `services/transfer`, Daten über Tauri-Binär-IPC. |
| **Projekt-Hub** | Projekte, Ideen-Notizen und Planer-Board (Ideen / Zu erledigen / In Arbeit / Fertig), Zuständigkeit, Live-Tempo an Ideen, Vorlage „Track fertigstellen“ (10 Schritte), Fortschritt. SQLite; offline nutzbar; Abgleich per Lamport-Uhr (Last-Writer-Wins, Grabsteine) in TS und Rust. |
| **Einrichtung/Einstellungen** | Assistent: Kamera/Mikrofon-Test mit Pegel, LAN-Port-Test, Anzeigename. Einstellungen: Signalisierungsserver, STUN (öffentlich abschaltbar), LAN-Port. |

## Testergebnisse (lokal, Linux x86_64, 21.11.2026)

| Suite | Ergebnis |
|---|---|
| Rust (`cargo test --workspace`) | **45 bestanden** – daw-bridge 17 + AbletonOSC-Harness 8, Signalisierung 2 + 6 (echte WebSockets), Transfer 6, Desktop (Settings/Hub) 6 |
| TypeScript (`npx vitest run`) | **35 bestanden** – Protokoll 17 (Allowlist, Hub-Abgleich, Nachrichtenprüfung, Einladungen, Sicherheitscode, Dateirahmen), Sitzungslogik + Dateien 13, App 5 |
| Collab-E2E, 2 Teilnehmer (`tests/e2e/collab-e2e.mjs`) | **22/22** – siehe unten |
| Tauri-App-E2E (`tests/e2e/run-e2e.mjs`, WebDriver) | **20/20**, 1 übersprungen (WebRTC in WebKitGTK nicht verfügbar) |

### Collab-E2E – was echt ist und was nicht

Echt: gebaute Oberfläche, `lom-signaling`-Binary, WebRTC (Video, Audio, DataChannels) in **Chromium** – derselben Engine wie WebView2
unter Windows –, gesamte Sitzungs-, Hub- und Dateilogik. Simuliert: das Tauri-Rust-Backend (Mock-DAW, Speicher im Browser,
`tests/e2e/mock-backend.mjs`) und Kamera/Mikrofon (Chromium-Testgeräte). Das echte Rust-Backend für Hub, Hosting und Dateiempfang
ist im Tauri-E2E geprüft (SQLite-Eintrag, eingebetteter Server startet, Binär-IPC-Empfang mit SHA-256, Path Traversal, `.exe`, Lücken, Import-Schutz).

Geprüft (Auszug): Einladung → Verbindung in ~250 ms · gleicher Sicherheitscode · Video in beide Richtungen + Audiospur · gemessene RTT/
Jitter/Verlust/Bitrate · Gast ohne Freigabe gesperrt · **roher DataChannel-Befehl ohne Freigabe vom Host abgelehnt** · Anfrage →
gemeinsame Freigabe → Gast startet Play und setzt Tempo in der Host-DAW · komplette Übergabe sperrt den Host · Zurückholen wirkt sofort ·
Idee des Gastes sofort beim Host · Planer-Vorlage und Statusänderungen synchron · 3-MB-WAV per Drag & Drop mit identischem SHA-256,
`.exe` abgewiesen · Abbruch hebt Freigabe auf · Wiederverbindung mit derselben Einladung, Hub vollständig abgeglichen, keine automatische Freigabe.

## Screenshots

Collab-E2E (Chromium, simuliertes Backend, Testbild-Kameras):
`11-session-host-wartet`, `12-session-host-verbunden`, `13-gast-studio-ohne-freigabe`, `14-host-steuerungsanfrage`,
`15-gast-steuert-host-daw`, `16-host-steuerung-uebergeben`, `17-hub-planer`, `18-samples-empfangen` (alle `docs/screenshots/*.png`).
Tauri-App (Linux/WebKitGTK): `01`–`05` aus Sprint 1, neu aufgenommen.

## Nicht getestet / offene Probleme

1. **Nicht unter Windows/WebView2 getestet**: Kamera-/Mikrofonfreigabe in WebView2, Bildschirmfreigabe, **Systemton-Erfassung
   (DAW-Mix)**, `restrictOwnAudio`, Windows-Firewall-Abfrage beim LAN-Hosting. Bildschirmfreigabe ist in keinem automatischen Test enthalten.
2. **Nicht über das Internet getestet**: STUN/TURN, Docker-Compose-Deployment und Caddy/TLS sind ungetestet; alle E2E-Verbindungen liefen über Loopback.
3. WebRTC im Linux-Build (WebKitGTK) nicht verfügbar → die Linux-App kann keine Sessions führen (Zielplattform ist Windows).
4. Echtes Ableton nicht beteiligt (siehe Sprint 1); Remote-Steuerung wurde gegen Mock-DAW geprüft, AbletonOSC-Befehle selbst gegen die Harness.
5. DAW-Ton läuft über den Windows-Systemton; reiner ASIO-Betrieb ohne Windows-Ausgabe liefert Stille. Eigener ASIO-/Loopback-Dienst steht aus (Sprint 3).
   Latenz des DAW-Tons ist nicht gemessen.
6. Dual Studio koppelt Transport über das Netz (nicht sample-genau); Phasengleichheit nur mit Ableton Link im LAN.
7. Maus-/Tastatur-Fernsteuerung (Sprint 4) bewusst nicht enthalten; „Steuerung übergeben“ betrifft die DAW-Befehle der Allowlist.
8. SHA-256 wird beim Sender im Speicher berechnet → Grenze 200 MB je Datei.
9. Natives Herausziehen empfangener Dateien direkt in Live (Drag-out) fehlt; Übernahme erfolgt über den Projektordner.
10. Der Hub hat keine Rechteverwaltung: jeder Teilnehmer darf alle Einträge des gemeinsamen Projekts ändern/löschen (Grabsteine bleiben erhalten).
11. Signalisierung ohne Ratenbegrenzung pro IP; für öffentliche Server Reverse-Proxy-Limits setzen.
12. Einladungscodes sind bis zum Sitzungsende gültig (kein Ablaufdatum).
