# Test unter Windows 11 mit Ableton Live 12 Suite

> **Kurzfassung:** [Schnellstart-PDF](../schnellstart/Connect-Studio-Schnellstart.pdf) (2 Seiten). Ab Version 0.3.0 installiert
> der Einrichtungsassistent AbletonOSC per Klick (Schritt 2) – Abschnitt 2 unten ist dann nur noch die manuelle Alternative.

Diese Anleitung führt durch den **ersten echten Hardware-Test**. Alles, was Sie hier prüfen, wurde
bisher nur gegen die AbletonOSC-Testgegenstelle (echter AbletonOSC-Code, simulierte Live-API) und
unter Linux getestet – **noch nie gegen echtes Ableton Live unter Windows.**

## 1. Connect Studio beschaffen

### Variante A – Installer aus der CI (empfohlen)

1. GitHub → Repository → **Actions** → Workflow **CI** → neuester Lauf auf Branch
   `claude/lock-o-motiv-sprint-1-g49atg`.
2. Unten unter *Artifacts* **`connect-studio-windows-installer`** herunterladen und entpacken.
3. Prüfsumme kontrollieren (PowerShell im entpackten Ordner):
   ```powershell
   Get-FileHash .\*setup.exe -Algorithm SHA256
   Get-Content .\*.sha256
   ```
   Beide Werte müssen übereinstimmen.
4. `LOCK-O-MOTIV Connect Studio_0.3.0_x64-setup.exe` ausführen. Der Installer ist **nicht signiert** –
   Windows SmartScreen warnt; *Weitere Informationen → Trotzdem ausführen*. Installation erfolgt pro
   Benutzer (keine Administratorrechte).

### Variante B – aus dem Quellcode

Voraussetzungen (einmalig): [Git](https://git-scm.com), [Node.js 22 LTS](https://nodejs.org),
[Rust (rustup, MSVC)](https://rustup.rs), *Visual Studio Build Tools 2022* mit Workload
„Desktopentwicklung mit C++“. WebView2 ist in Windows 11 enthalten. Python 3 nur für die Tests.

```powershell
git clone https://github.com/lockomotiv/ableton-studio-toolz.git
cd ableton-studio-toolz
git checkout claude/lock-o-motiv-sprint-1-g49atg
npm ci
# Entwicklungsmodus (Hot Reload):
npm run dev
# oder Installer bauen → target\release\bundle\nsis\*.exe
cd apps\desktop; npx tauri build
```

Optional die automatischen Tests unter Windows ausführen:
```powershell
.\scripts\fetch-abletonosc.ps1
cargo test --workspace
npx vitest run
```

## 2. AbletonOSC installieren

1. https://github.com/ideoforms/AbletonOSC → *Code → Download ZIP* (geprüft wurde Commit `0ca6821`;
   neuere Stände sollten funktionieren, sind aber ungeprüft).
2. Entpacken und den Ordner in **`AbletonOSC`** umbenennen (nicht `AbletonOSC-master`).
3. Nach `%USERPROFILE%\Documents\Ableton\User Library\Remote Scripts\` kopieren, sodass
   `…\Remote Scripts\AbletonOSC\manager.py` existiert. (Bei OneDrive-Dokumentenordner: dort.)
4. Ableton Live 12 Suite starten → *Optionen → Einstellungen → Link, Tempo & MIDI* →
   *Control Surface*: **AbletonOSC** (Ein-/Ausgang: Keine).
5. Statuszeile in Live: „AbletonOSC: Listening for OSC on port 11000“.
6. Falls die Windows-Firewall fragt: **nicht** erlauben. Dann die Regel aus
   [`docs/security/osc-firewall.md`](../security/osc-firewall.md) anlegen.

## 3. Ein Testprojekt vorbereiten

Neues Live-Set mit mindestens **4 Audio-/MIDI-Spuren** und **mindestens einem Clip in Spur 1, Slot 1**
(Session-Ansicht). Nicht Ihr Arbeitsprojekt verwenden – Connect Studio verändert Tempo, Loop,
Lautstärke und Panorama.

## 4. Einrichtungsassistent

Connect Studio starten (Desktop-/Startmenü). Beim ersten Start öffnet sich **Einrichtung**:

| Schritt | Erwartung |
|---|---|
| 1 Ableton Live erkennen → *Jetzt prüfen* | „Ableton Live 12 installiert“: OK mit Pfad; „Ableton Live läuft“: OK |
| 2 AbletonOSC prüfen → *Installation prüfen* | „AbletonOSC Remote Script installiert“: OK mit Pfad; „Antwortport 127.0.0.1:11001“: OK; „OSC-Port nur lokal erreichbar“: **Warnung** (erwartet, siehe Firewall-Dokument) |
| 3 Verbindung testen | grüner Hinweis „AbletonOSC antwortet (Ableton Live 12.x)“ mit gemessener Zeit; Live zeigt „Received OSC OK“ |
| 4–6 | als „Noch nicht implementiert“ gekennzeichnet → *Überspringen* |
| 7 Rolle & Modus | Host / Remote Studio / **AbletonOSC** → *Einrichtung abschließen* |

Danach startet Connect Studio direkt mit dem AbletonOSC-Adapter.

## 5. Funktionstest (bitte Ergebnisse notieren)

Links unten muss **„Mit Ableton verbunden · Ableton Live 12.x“** (grün) stehen.

| # | Aktion in Connect Studio | Erwartung in Live / Connect Studio | Ergebnis |
|---|---|---|---|
| 1 | Play | Live startet; „▶ Läuft“; Protokoll ✔ | |
| 2 | Stop | Live stoppt; „■ Gestoppt“; ✔ | |
| 3 | Tempo 128 → Setzen | Live zeigt 128.00 BPM; ✔ | |
| 4 | Tempo in **Live** auf 100 ändern | Connect Studio zeigt binnen ~1 s 100.00 | |
| 5 | Loop an / aus | Loop-Schalter in Live folgt; ✔ | |
| 6 | Spuren: Namen stimmen mit Live überein | Reihenfolge und Namen identisch (ohne Return/Master) | |
| 7 | Lautstärke Spur 2 auf ~50 % ziehen und loslassen | Fader in Live bewegt sich; ✔ | |
| 8 | Panorama Spur 1 nach links | Pan-Regler in Live folgt; ✔ | |
| 9 | Clip starten: Spur 1, Slot 1 | Clip startet (ggf. nach Quantisierung); ✔ | |
| 10 | Clip starten auf leerem Slot | Fehlermeldung „enthält keinen Clip“, Verbindung bleibt grün | |
| 11 | Live schließen | binnen ~2 s „Nicht verbunden“ (rot), Bedienelemente gesperrt | |
| 12 | Live wieder öffnen (Set laden) | ohne Neustart von Connect Studio wieder „Verbunden“ | |
| 13 | Diagnose → *Diagnose ausführen* | Alle Prüfungen außer „OSC-Port nur lokal“ OK | |
| 14 | Einstellungen → Mock | gelbes „MOCK-MODUS“; Play wirkt **nicht** auf Live | |

⚠ in der Protokollspalte bedeutet: gesendet, aber Live hat den Zustand nicht innerhalb von 1,2 s
bestätigt. Bitte notieren, bei welchem Befehl das auftritt.

## 6. Latenzmessung (optional)

Connect Studio schließen (Port 11001 wird exklusiv benötigt), Live mit AbletonOSC offen lassen:

```powershell
cargo run --release -p lom-daw-bridge --example osc_latency -- --count 200 --json latenz.json
```

Das Programm setzt das **aktuelle** Tempo erneut (keine Projektänderung) und gibt gemessene
Roundtrip-Zeiten aus. Bitte `latenz.json` zurückmelden.

## 7. Was zurückmelden?

* Ausgefüllte Tabelle aus Abschnitt 5
* Screenshot der Diagnose-Seite
* `%APPDATA%\de.lockomotiv.connectstudio\logs\daw-commands.jsonl`
* `%USERPROFILE%\Documents\Ableton\User Library\Remote Scripts\AbletonOSC\logs\abletonosc.log`

## Fehlerbehebung

| Symptom | Ursache / Lösung |
|---|---|
| „UDP-Port 127.0.0.1:11001 konnte nicht geöffnet werden“ | Ein anderes OSC-Programm (z. B. eine zweite Connect-Studio-Instanz, TouchOSC-Bridge, Max-Patch) belegt 11001. Dieses beenden. |
| „Keine Antwort von AbletonOSC … (Timeout)“ | Live läuft nicht, AbletonOSC ist nicht als Control Surface gewählt, oder der Ordner heißt nicht exakt `AbletonOSC`. AbletonOSC-Log prüfen. |
| „AbletonOSC Remote Script installiert“ = Fehler, obwohl installiert | Abweichender User-Library-Ort. Umgebungsvariable `LOM_ABLETON_USER_LIBRARY` auf den User-Library-Ordner setzen. |
| „Ableton Live 12 installiert“ = Fehler | Installation außerhalb `%ProgramData%\Ableton` / `%ProgramFiles%\Ableton`. Rein informativ; die OSC-Verbindung ist maßgeblich. |

---

# Teil 2: Zusammenarbeit testen (Sprint 2)

Benötigt: **zwei Windows-11-Rechner** (A = Host mit Ableton, B = Gast), beide mit Connect Studio 0.2.0, Kopfhörer, Kamera/Mikrofon.
Zuerst im selben Netz (LAN), danach optional über das Internet mit eigenem Server ([Selbst hosten](../deployment/selbst-hosten.md)).

| # | Aktion | Erwartung | Ergebnis |
|---|---|---|---|
| 1 | A: *Session* → Remote Studio, Lokales Netz, Projekt „Test“ → Starten | Windows-Firewall fragt → nur *Privat* erlauben; Einladungscode erscheint | |
| 2 | B: *Session* → Code einfügen → Beitreten | Kamera-/Mikrofonabfrage von WebView2; beide „Verbunden“ | |
| 3 | Sicherheitscode vergleichen | identisch auf A und B | |
| 4 | Video/Ton in beide Richtungen | Bild + Stimme, Mikrofon stumm/an funktioniert | |
| 5 | A: *Bildschirm + DAW-Ton* → Ableton-Fenster/Bildschirm wählen, „Systemaudio teilen“ an | B sieht Ableton und hört den Mix | |
| 6 | B hört den Mix: ist B's eigene Stimme darin als Echo zu hören? | Nein (mit Kopfhörern bei A) | |
| 7 | B: *Studio* → Play | gesperrt mit „Keine Steuerfreigabe“ | |
| 8 | B: *Steuerung anfragen* → A: *Gemeinsam steuern* | B kann Play/Stop/Tempo/Fader; Live bei A reagiert, ✔ im Protokoll | |
| 9 | A: *Komplett übergeben* | A's Studio gesperrt; B steuert; A: *Zurückholen* wirkt sofort | |
| 10 | B: WAV aus dem Explorer ins Connect-Studio-Fenster ziehen | A: Angebot → Annehmen → „Prüfsumme identisch“; Datei in `Dokumente\LOCK-O-MOTIV Connect Studio\Empfangen` | |
| 11 | A: *Samples* → Projektordner des Live-Sets eintragen → *Ins Projekt übernehmen* | Datei unter `Samples\Imported\Connect Studio`, in Live-Browser sichtbar | |
| 12 | B: *Projekt-Hub* → Idee festhalten; A: Vorlage einfügen, Karte verschieben | erscheint jeweils sofort beim anderen | |
| 13 | B: WLAN kurz trennen (10 s) | A: „Verbindung unterbrochen“, Steuerung zurück bei A; danach automatische Wiederverbindung | |
| 14 | Dual Studio: beide Rechner mit Ableton, Session im Dual-Modus | Play bei A startet auch B (Kopplung an); Fader werden nicht gespiegelt | |
| 15 | Lokal: Studio → 🔗 Link an (beide) | Tempo/Phase in beiden Live-Instanzen synchron | |

Bitte zusätzlich die Werte aus *Session → Verbindung (gemessen)* notieren (Weg, RTT, Jitter, Verlust) und Screenshots beider Seiten schicken.
