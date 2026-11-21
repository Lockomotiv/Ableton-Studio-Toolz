# Lizenzprüfung (Stand Sprint 1)

Ziel: kostenlose, möglichst quelloffene Software ohne Pflichtabonnements.
Connect Studio selbst steht unter **MIT** (`Cargo.toml`, `package.json`).

## Geprüfte Kernkomponenten

| Komponente | Lizenz | Geprüft anhand | Bewertung |
|---|---|---|---|
| AbletonOSC (Commit 0ca6821) | MIT | `LICENSE.md` im Repository | ✔ Nutzung und Weitergabe erlaubt. Wird in Sprint 1 **nicht** mitgeliefert, sondern vom Benutzer installiert. |
| python-osc (in AbletonOSC eingebettet, Ordner `pythonosc/`) | Unlicense (laut python-osc-Projekt; im AbletonOSC-Checkout liegt keine eigene Lizenzdatei für diesen Ordner) | Projektangabe python-osc | ⚠ Vor einer Weitergabe von AbletonOSC durch uns (z. B. im Installer) Lizenzdatei ergänzen. |
| Tauri 2 | MIT OR Apache-2.0 | crates.io-Metadaten | ✔ |
| React 18.3.1 | MIT | package-lock | ✔ |
| rosc (OSC-Codec) | MIT OR Apache-2.0 | crates.io-Metadaten | ✔ |
| rusqlite + SQLite (bundled) | MIT; SQLite gemeinfrei | crates.io-Metadaten | ✔ |
| sysinfo, dirs, tokio, serde | MIT bzw. MIT OR Apache-2.0 | crates.io-Metadaten | ✔ |

Vollständige Liste: [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) (464 Crates, 6 npm-Laufzeitpakete),
maschinenlesbar: `license-summary.json`, SBOMs (CycloneDX 1.5): `sbom-rust-desktop.cdx.json`,
`sbom-rust-daw-bridge.cdx.json`, `sbom-npm.cdx.json`.

> Die npm-SBOM (`npm sbom`) erfasst in diesem Workspace-Aufbau nicht alle Laufzeitpakete (React fehlt).
> Maßgeblich für die Lizenzliste ist daher `THIRD_PARTY_NOTICES.md`, das direkt aus `package-lock.json` erzeugt wird.

## Markierte Abhängigkeiten

| Paket | Lizenz | Herkunft | Bewertung |
|---|---|---|---|
| `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short` | MPL-2.0 | Tauri (`tauri-utils` → `dom_query`) | Schwaches, dateibasiertes Copyleft. Unveränderte Nutzung in einem MIT-Programm ist zulässig; Pflicht: Hinweis + Quellcode der MPL-Dateien verfügbar halten (crates.io). Keine Änderungen an diesen Dateien vornehmen. |
| `option-ext` | MPL-2.0 | `dirs` → `dirs-sys` (eigene Abhängigkeit) | wie oben; alternativ in Sprint 2 `dirs` durch Windows-API (`SHGetKnownFolderPath`) ersetzen. |
| `r-efi` | MIT OR Apache-2.0 OR LGPL-2.1+ | Zufallszahlen (UEFI-Ziel, für Windows irrelevant) | ✔ Wahl MIT. |

## SonoBus (optional, Sprint 3)

Nicht Bestandteil von Sprint 1; keine Integration, kein Code. SonoBus steht nach unserem Kenntnisstand unter
**GPLv3** und überträgt Audio nach unserem Kenntnisstand **unverschlüsselt**. Beides ist **nicht verifiziert** und wird vor
Sprint 3 gegen die dann aktuelle SonoBus-Version und -Dokumentation geprüft. Eine Einbettung von GPL-Code in Connect Studio
ist nicht vorgesehen; SonoBus wäre ein separat installiertes, separat lizenziertes Programm.

## Offene Punkte

* Vollständige Lizenztexte in THIRD_PARTY_NOTICES / Installer (Sprint 5, z. B. `cargo-about`).
* Lizenzprüfung als CI-Schritt mit Fehlschlag bei neuen Copyleft-Lizenzen.
* Ableton Live selbst ist proprietär und wird weder mitgeliefert noch verändert.
