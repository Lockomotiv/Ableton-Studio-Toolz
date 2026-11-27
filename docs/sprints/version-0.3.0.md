# Version 0.3.0 – Testversion für Windows 11 + Ableton Live 12

## Neu

| Bereich | Änderung | Nachweis |
|---|---|---|
| **AbletonOSC mit einem Klick** | Geprüfte AbletonOSC-Version (Commit 0ca6821, MIT) liegt dem Installer bei. Einrichtungsassistent Schritt 2: „AbletonOSC installieren“. Vorhandene Version wird nach `Dokumente\LOCK-O-MOTIV Connect Studio\Sicherungen` verschoben, nie gelöscht. | Rust-Unit-Tests `abletonosc_install`, Tauri-E2E |
| **Nur lokal erreichbar** (Standard) | Bei der Installation wird die Bind-Adresse von `0.0.0.0` auf `127.0.0.1` gesetzt – Live ist nicht mehr aus dem LAN steuerbar (Sicherheitsbefund aus Sprint 1 behoben). Einzige Änderung am Original, dokumentiert in `CONNECT_STUDIO.txt`. | Integrationstest `local_only_patch_binds_loopback_and_works`: gepatchte Version lauscht nur auf 127.0.0.1:11000 und funktioniert; Gegenprobe: Original belegt alle Schnittstellen |
| **Einladungen mit Ablaufzeit** | 1 h / 24 h / 7 Tage; vom Server durchgesetzt (Code `expired`). | `expired_invite_rejects_guest_but_not_host`, `valid_expiry_lets_guest_in` |
| **Schutz gegen Durchprobieren** | Signalisierung: max. 30 Join-Versuche und 10 Fehlversuche je IP und Minute. | `brute_force_is_rate_limited` |
| **Samples bis 2 GB** | SHA-256 wird schrittweise berechnet (konstanter Speicher) statt im Ganzen; Grenze 200 MB → 2 GB (Sender und Rust-Empfang). | NIST-Testvektoren, Vergleich mit WebCrypto bei beliebiger Blockgröße |
| **Schnellstart-PDF** | Zwei Seiten: Installieren, Einrichten, Test allein, Test zu zweit, Link, Rückmeldung, Fehlerbehebung. Liegt dem Installer-Download bei. | `docs/schnellstart/` |
| CI | Windows-E2E: WebDriver passend zur WebView2-Version, Playwright für den Chromium-Gast. | CI |

## Tests (lokal, Linux)

Rust 53 · TypeScript 38 · Tauri-App-E2E 21/21 (+1 übersprungen: WebRTC in WebKitGTK) · Collab-E2E 22/22.
CI-Lauf 1 auf GitHub (Stand 0.2.0): Linux komplett grün inkl. beider E2E; **Windows: alle Rust-Tests inkl. AbletonOSC-Harness grün**.

## Weiterhin offen

Test mit echtem Ableton Live unter Windows; Kamera/Bildschirm/DAW-Ton in WebView2; Internet-Betrieb mit eigenem Server;
ASIO-Audiodienst (Sprint 3); Drag-out empfangener Samples direkt in Live; Hub-Rechte; Code-Signatur.
