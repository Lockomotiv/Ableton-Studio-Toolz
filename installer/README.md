# installer (Sprint 5)

Der Windows-Installer wird von Tauri als **NSIS**-Paket erzeugt (Konfiguration: `apps/desktop/src-tauri/tauri.conf.json`, `bundle.windows.nsis`, Installation pro Benutzer).

In Sprint 1 wird der Installer nur von der CI auf `windows-latest` gebaut und mit SHA-256-Prüfsumme als Artefakt hochgeladen. Er ist **ungetestet** (keine Installations-/Deinstallationstests, keine Signatur, kein automatischer Start des Einrichtungsassistenten außer dem normalen Erststart der App).
