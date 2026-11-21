# Sicherheitsstand Sprint 1

| Anforderung | Umsetzung in Sprint 1 | Nachweis |
|---|---|---|
| OSC-Port nur lokal | Connect Studio bindet/sendet nur `127.0.0.1`, verwirft Nicht-Loopback-Pakete. AbletonOSC selbst bindet `0.0.0.0` → Diagnose-Warnung + [Firewall-Anleitung](osc-firewall.md) | `bind_is_loopback_only`, `netstat_parsing_detects_wildcard` |
| Befehls-Allowlist | `DawCommand`-Enum, keine generischen OSC-Adressen; Wertebereiche in Rust validiert (zusätzlich im Frontend) | `unknown_command_is_rejected_by_deserializer`, `ranges_are_validated`, `index.test.ts` |
| Geordnete Befehlsverarbeitung | Async-Mutex um `daw_execute` | Code-Review (`apps/desktop/src-tauri/src/lib.rs`) |
| Keine Sitzungsgeheimnisse im Code | Sprint 1 hat keine Netzwerk-Sitzungen und keine Geheimnisse | – |
| Tauri-Rechte minimal | Nur `core:default`; keine Shell-, FS-, HTTP-Plugins; CSP gesetzt | `capabilities/default.json`, `tauri.conf.json` |
| Keine Aufnahme von Audio/Video | Sprint 1 greift nicht auf Kamera/Mikrofon zu | – |
| Keine Treiberinstallation | Keine | – |
| Keine automatische Installation von AbletonOSC | Nur Anleitung + Prüfung | Einrichtungsassistent Schritt 2 |
| Sichere Zustände bei Abbruch | Timeout → `unreachable`, Bedienelemente gesperrt | E2E „Verbindungsabbruch“, `connection_loss_and_recovery` |

## Noch nicht umgesetzt (spätere Sprints)

Authentifizierte Steuerkanäle, Berechtigungssystem Host/Gast, TLS/WebRTC-Verschlüsselung,
Windows Credential Manager, Fernsteuerung, Sample Exchange (Path-Traversal-Schutz),
Code-Signatur des Installers.
