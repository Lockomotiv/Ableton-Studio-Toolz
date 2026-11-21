# Sprint 1 – Desktop-App und lokaler AbletonOSC-Adapter

**Stand:** 0.1.0 · Branch `claude/lock-o-motiv-sprint-1-g49atg`

## Umgesetzt

| Bereich | Inhalt | Getestet |
|---|---|---|
| Repository | Struktur nach Vorgabe, Cargo-/npm-Workspaces, CI (Linux + Windows) | Build lokal (Linux) |
| Tauri-App | React/TS-Oberfläche: Studio, Diagnose, Einrichtung, Einstellungen | E2E gegen gebaute App (Linux) |
| Mock-Adapter | In-Memory-Live-Session, überall als „MOCK-MODUS“ gekennzeichnet | Unit + E2E |
| AbletonOSC-Adapter | UDP nur 127.0.0.1, Play/Stop/Fortsetzen, BPM, Loop, Spuren, Lautstärke, Panorama, Clip starten, Live-Version, `/live/error`, Timeout-/Abbruch-Erkennung, Wiederverbindung, Rücklese-Verifikation | Integration gegen echten AbletonOSC-Code; **nicht gegen echtes Live** |
| Diagnose | Live-Installation (Windows), Live-Prozess, Remote Script, Antwortport, `/live/test` mit RTT, Live-Version, API-Kompatibilität (nur lesend), OSC-Exposition (netstat, Windows), gemessene Laufzeiten, SQLite | Unit + Integration + E2E (Windows-spezifische Prüfungen nur Parser-Unit-Test) |
| Einrichtungsassistent | Schritte 1–3 und 7 funktional; 4–6 sichtbar als „nicht implementiert“ | E2E (Erststart), Schritt 3 manuell |
| Einstellungen | SQLite (Rolle, Standardmodus, Startadapter, Einrichtung abgeschlossen) | Unit |
| Messwerte | OSC-Roundtrip (min/Ø/p95/max/Timeouts), Befehlsdauer inkl. Verifikation, JSONL-Protokoll, Messprogramm `osc_latency` | Unit + Messlauf gegen Harness |
| Lizenzen | THIRD_PARTY_NOTICES, CycloneDX-SBOMs, Lizenzprüfung | generiert |

## Testergebnisse (lokal, Linux x86_64, 21.11.2026)

| Suite | Befehl | Ergebnis |
|---|---|---|
| Rust Unit | `cargo test --workspace` | 19 bestanden (17 daw-bridge, 2 settings) |
| Rust Integration (AbletonOSC-Harness) | `cargo test -p lom-daw-bridge --test abletonosc_harness` | 8 bestanden |
| TypeScript Unit/Komponenten | `npx vitest run` | 12 bestanden |
| TypeScript Typprüfung | `npm run typecheck` | fehlerfrei |
| E2E (gebaute App, tauri-driver + WebKitWebDriver, Xvfb) | `node tests/e2e/run-e2e.mjs` | 15/15 bestanden |
| Performance (Harness) | `tests/performance/osc-latency.sh` | 402 Messungen, Ø 100,4 ms, p95 102,3 ms, 0 Timeouts |

Die Harness-Latenz spiegelt den nachgebildeten 100-ms-Tick wider und ist **kein Messwert für echtes Ableton Live**.

### Abdeckung der Pflichtszenarien (Sprint-1-relevant)

| Szenario | Status |
|---|---|
| Client startet ohne Ableton im Mock-Modus | ✔ automatisiert (Unit, Komponente, E2E) |
| AbletonOSC-Verbindung wird erkannt | ✔ automatisiert gegen AbletonOSC-Harness · ☐ echtes Live (manuell, siehe Testanleitung) |
| Play/Stop-Befehle werden korrekt ausgeführt | ✔ automatisiert gegen Harness (Wirkung unabhängig über Harness-Ereignisse geprüft) · ☐ echtes Live |
| Verbindungsabbruch führt zu sicherem Zustand | ✔ für die lokale DAW-Verbindung (Integration + E2E) |
| Alle übrigen Szenarien (LAN, Internet, Video, Audio, Transfer, Fernsteuerung, Dual Studio, Installation) | ☐ spätere Sprints |

## Screenshots (echte Aufnahmen der gebauten App)

Aufgenommen per WebDriver während des E2E-Laufs unter **Linux (WebKitGTK)**, nicht unter Windows (WebView2).
„Mit Ableton verbunden · Ableton Live 12.1“ in 04/05 stammt von der **AbletonOSC-Harness** (echter AbletonOSC-Code,
simulierte Live-API mit gemeldeter Version 12.1) – nicht von einem echten Ableton Live.

| Datei | Zustand |
|---|---|
| `docs/screenshots/01-einrichtung-erststart.png` | Erststart, Einrichtungsassistent, Mock-Modus |
| `docs/screenshots/02-studio-mock.png` | Studio im Mock-Modus nach Play |
| `docs/screenshots/03-studio-nicht-verbunden.png` | AbletonOSC gewählt, keine Gegenstelle → „Nicht verbunden“, Bedienung gesperrt |
| `docs/screenshots/04-studio-abletonosc.png` | Verbunden mit Harness, Play + Tempo 128 verifiziert |
| `docs/screenshots/05-diagnose-abletonosc.png` | Diagnose gegen Harness mit gemessenen Laufzeiten |

## Nicht getestet / offene Probleme

1. **Kein Test gegen echtes Ableton Live 12 Suite unter Windows 11.** Timing, Quantisierung beim Clip-Start,
   Verhalten bei großen Sets und das Umschalten von Live-Sets sind unbekannt → [Testanleitung](../troubleshooting/windows-test-anleitung.md).
2. **Windows-Build und NSIS-Installer** werden nur in der CI erzeugt; Installation/Deinstallation ungetestet,
   Installer nicht signiert (SmartScreen-Warnung).
3. Windows-spezifische Diagnosen (Installationspfad, `netstat`, `CREATE_NO_WINDOW`) sind nur per Parser-Unit-Test
   bzw. gar nicht auf echtem Windows ausgeführt.
4. **AbletonOSC lauscht auf `0.0.0.0:11000`** – Connect Studio kann das nicht ändern; Firewall-Regel nötig
   ([Anleitung](../security/osc-firewall.md)). Wirksamkeit der Regel auf Ihrem System ungetestet.
5. Port 11001 ist exklusiv: Connect Studio und andere AbletonOSC-Clients (oder das Messprogramm) können nicht gleichzeitig laufen.
6. Statusabfrage per Polling (1 s). Änderungen in Live erscheinen mit bis zu ~1,1 s Verzögerung; AbletonOSC-Listener
   werden noch nicht genutzt.
7. Spurliste enthält keine Return-/Master-Spur (AbletonOSC-Verhalten); Lautstärke als Live-Mixerwert, nicht in dB.
8. Setup-Schritte 4–6 (ASIO, Kamera/Mikrofon, Netzwerk) nicht implementiert.
9. Windows-Credential-Manager noch ungenutzt (Sprint 1 speichert keine Geheimnisse).
10. MPL-2.0-Abhängigkeiten (`cssparser`, `selectors`, `option-ext`) – zulässig, aber in den Notices zu führen;
    vollständige Lizenztexte fehlen noch.
11. Windows-E2E in der CI ist als experimentell markiert (`continue-on-error`).
