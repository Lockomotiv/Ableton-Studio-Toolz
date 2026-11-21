# Sicherheitsmodell der Zusammenarbeit (Sprint 2)

| Bedrohung | Maßnahme | Nachweis |
|---|---|---|
| Fremde treten der Session bei | Zufällige Raum-ID (64 bit) + Einladungsgeheimnis (192 bit); Server speichert nur SHA-256; max. 1 Host + 1 Gast | `rooms.rs: wrong_token_and_missing_room_are_rejected`, `third_participant_is_rejected` |
| Server/Netz liest mit | Medien und DataChannels Ende-zu-Ende über DTLS/SRTP; Signalisierung via `wss://` (Caddy/TLS); Warnung bei `ws://` außerhalb privater Netze | `isInsecureServer`-Test |
| Manipulierter Signalisierungsserver (Man-in-the-Middle) | Sechsstelliger **Sicherheitscode** aus beiden DTLS-Fingerprints, mündlich vergleichen | `securityCode`-Tests; E2E: identischer Code |
| Gast steuert ohne Erlaubnis | Host prüft **jede** `daw-cmd`-Nachricht gegen aktuelle Freigabe; UI-Sperre ist nur Komfort | `core.test.ts`, E2E „Roher DataChannel-Befehl … abgelehnt“ |
| Schädliche DAW-Befehle | Nur Allowlist-Befehle (kein Löschen, keine beliebigen OSC-Adressen); Wertebereiche in TS **und** Rust geprüft; 20 Befehle/s | `parseSessionMessage`-Tests, `command.rs`-Tests |
| Freigabe überdauert Abbruch | Abbruch/Ende → Steuerung sofort Host-only; offene Fernbefehle werden abgebrochen; keine automatische Freigabe nach Wiederverbindung | `core.test.ts`, E2E |
| Manipulierte Nachrichten | Strenges Schema je Nachrichtentyp, Größengrenze 512 KiB, unbekannte Typen verworfen | `collab.test.ts` |
| Schadhafte Dateien | Nur Audio/MIDI-Endungen (Sender + Empfänger), ausdrückliche Annahme, Name auf eine Komponente bereinigt (kein `..`, keine Laufwerke, keine reservierten Windows-Namen), Empfangsordner fest, kein Überschreiben, nie geöffnet/ausgeführt, SHA-256-Prüfung, Größengrenze | `services/transfer`-Tests, Tauri-E2E Abschnitt G |
| Schreiben ins Ableton-Projekt | Nur auf Knopfdruck, nur in Ordner mit `.als`, Unterordner `Samples/Imported/Connect Studio`, `create_new` (nie überschreiben) | `import_requires_ableton_project_and_does_not_overwrite` |
| Hub-Manipulation | Schema-/Längenprüfung in TS und Rust (32 KiB/Eintrag, 2000/Batch), nur Einträge des gemeinsamen Projekts | `hub.rs`-Tests, `isValidHubItem` |
| TURN-Missbrauch | Zeitlich begrenzte Zugangsdaten (12 h); coturn verweigert Relays in private Netze | `docker-compose.yml` |
| Kamera/Mikrofon ohne Wissen | Zugriff nur beim Sessionstart/Gerätetest; Stummschalten jederzeit; keine Aufzeichnung | Code-Review |
| Öffentlicher STUN gibt IP preis | Abschaltbar in den Einstellungen | – |

**Hinweis LAN-Hosting:** Der eingebettete Dienst lauscht während einer Host-Session auf allen Schnittstellen (Port 47870), damit
Gäste im LAN ihn erreichen. Er nimmt nur Teilnehmer mit gültigem Geheimnis an und transportiert keine Medien. Er wird beim Beenden
der Session gestoppt. Windows-Firewall: nur „Privates Netzwerk“ erlauben.

Offen: Ratenbegrenzung pro IP im Signalisierungsdienst, Ablauf von Einladungen, Rechteverwaltung im Hub, Code-Signatur.
