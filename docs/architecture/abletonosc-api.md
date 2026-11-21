# AbletonOSC – verwendete API (verifiziert)

**Geprüfte Version:** `ideoforms/AbletonOSC` Commit `0ca68214bd62c9b5cb641ca34006cfd70ba94430` (19.11.2025), MIT-Lizenz.
AbletonOSC hat keine Versionsnummern; Connect Studio bezieht sich daher auf diesen Commit
(`scripts/fetch-abletonosc.sh`).

Alle Adressen unten wurden **im Quellcode dieses Commits** nachgeschlagen und werden
automatisch gegen den unveränderten AbletonOSC-Code getestet
(`services/daw-bridge/tests/abletonosc_harness.rs`). Ein Test gegen echtes Ableton Live 12
steht aus (siehe Sprint-1-Bericht).

## Transportverhalten (aus `abletonosc/osc_server.py`, `manager.py`)

| Eigenschaft | Verhalten | Konsequenz für Connect Studio |
|---|---|---|
| Empfangsport | UDP **11000**, gebunden an **`0.0.0.0`** | AbletonOSC ist standardmäßig im LAN erreichbar → Diagnoseprüfung `osc_exposure` + Firewall-Anleitung |
| Antwortziel | immer `<Absender-IP>:11001` (Konstante `OSC_RESPONSE_PORT`) | Client muss lokal Port 11001 binden; nur ein Programm gleichzeitig möglich |
| Verarbeitung | einmal pro Live-Tick (~100 ms), alle wartenden Pakete | Roundtrip 0–100 ms ist normal; parallele Abfragen werden im selben Tick beantwortet |
| `set`/Methoden | **keine Antwort** | Connect Studio liest den Zustand danach zurück (`verified`) |
| Fehler | asynchron `/live/error <text>` (Logging-Handler) | gesammelt, in der Diagnose angezeigt |
| Start | `/live/startup` beim Laden | Live-Version wird neu erfragt |
| Wildcard `/live/track/get/volume *` | liefert wegen `return` in der Schleife nur Spur 0 | wird nicht verwendet; Abfrage pro Spur |

## Verwendete Adressen

| Funktion | Adresse | Argumente | Antwort |
|---|---|---|---|
| Verbindungstest | `/live/test` | – | `("ok",)` + Meldung in Lives Statuszeile |
| Live-Version | `/live/application/get/version` | – | `(major, minor)` |
| Play | `/live/song/start_playing` | – | keine |
| Stop | `/live/song/stop_playing` | – | keine |
| Fortsetzen | `/live/song/continue_playing` | – | keine |
| Läuft? | `/live/song/get/is_playing` | – | `(bool,)` |
| BPM lesen/setzen | `/live/song/get/tempo`, `/live/song/set/tempo` | set: `float` | get: `(float,)` |
| Loop lesen/setzen | `/live/song/get/loop`, `/live/song/set/loop` | set: `int 1/0` (wie AbletonOSC-Tests) | get: `(bool,)` |
| Spuranzahl | `/live/song/get/num_tracks` | – | `(int,)` |
| Szenenanzahl | `/live/song/get/num_scenes` | – | `(int,)` |
| Spurnamen | `/live/song/get/track_names` | – | `(str, …)` |
| Lautstärke | `/live/track/get/volume`, `/live/track/set/volume` | `track:int[, value:float]` | `(track, float)` |
| Panorama | `/live/track/get/panning`, `/live/track/set/panning` | `track:int[, value:float]` | `(track, float)` |
| Clip-Slot hat Clip | `/live/clip_slot/get/has_clip` | `track, slot` | `(track, slot, bool)` |
| Clip starten | `/live/clip_slot/fire` | `track, slot` | keine |
| Clip-Status | `/live/clip_slot/get/is_triggered`, `…/is_playing` | `track, slot` | `(track, slot, bool)` |

### Bekannte Fallstricke

* **Ungültiger Index** (Spur/Slot außerhalb des Bereichs) erzeugt in AbletonOSC eine Python-Exception
  → keine Antwort, nur `/live/error`. Connect Studio prüft Indizes deshalb vorher gegen
  `num_tracks`/`num_scenes`, damit kein Timeout als Verbindungsabbruch fehlinterpretiert wird.
* `/live/song/get/track_names` und `num_tracks` enthalten **nur reguläre Spuren** (keine Return-/Master-Spur).
* Lautstärke ist Lives interner Mixerwert 0.0–1.0 (0.85 ≈ 0 dB), nicht dB.
* `/live/test` blendet „Received OSC OK“ in Lives Statuszeile ein. Der Heartbeat verwendet daher
  Statusabfragen, `/live/test` nur bei explizitem Verbindungstest.
