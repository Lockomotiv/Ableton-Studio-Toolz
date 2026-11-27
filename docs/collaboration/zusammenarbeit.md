# Zusammenarbeiten mit Connect Studio

Drei Wege, gemeinsam an einem Track zu arbeiten:

| Situation | Weg | Was synchron ist |
|---|---|---|
| Beide im **selben Raum/Netz**, jeder mit eigenem Ableton | **Ableton Link** (in Live eingebaut) + optional Connect-Studio-Session im LAN für Hub und Samples | Tempo und Phase **sample-genau** über Link |
| **Online**, ein Ableton-Set beim Host | **Remote Studio** | Ein Projekt, beide steuern (nach Freigabe), Video, Sprache, Bildschirm + DAW-Ton |
| **Online**, jeder mit eigenem Ableton | **Dual Studio** | Play/Stop/Tempo/Loop gekoppelt (netzwerkbedingt nicht sample-genau), Video, Hub, Samples |

## Lokal: Ableton Link

Ableton Link ist Teil von Live und muss nicht programmiert werden. Connect Studio bietet nur einen Schalter dafür:
**Studio → 🔗 Link an** (setzt `is_ableton_link_enabled` über AbletonOSC; Rücklesen bestätigt den Zustand).
Alternativ in Live: *Einstellungen → Link, Tempo & MIDI → Link anzeigen* und oben links „Link“ einschalten.
Link funktioniert nur im lokalen Netz (Multicast), nicht über das Internet.

## Online: Session starten

**Host** (Seite *Session*):
1. Modus wählen – *Remote Studio* oder *Dual Studio*.
2. Verbindung wählen:
   * *Lokales Netz*: Connect Studio startet einen eingebauten Signalisierungsdienst (Port 47870). Windows fragt beim ersten Mal nach der
     Firewall-Freigabe – **nur „Privates Netzwerk“** erlauben.
   * *Internet*: eigener Signalisierungsserver aus *Einstellungen* (siehe [Selbst hosten](../deployment/selbst-hosten.md)).
3. Projekt im Hub wählen oder neu anlegen → **Sitzung starten**.
4. Den angezeigten **Einladungscode** (`LOM1.…`) vertraulich an den Partner schicken (z. B. Messenger).

**Gast:** *Session → Einladungscode einfügen → Beitreten.*

**Sicherheitscode:** Nach dem Verbinden zeigen beide Seiten einen sechsstelligen Code. Kurz über Video vergleichen – stimmt er überein,
sitzt niemand (auch nicht der Server) zwischen Ihnen.

## Steuerung teilen und übergeben (Remote Studio)

| Einstellung beim Host | Wirkung |
|---|---|
| **Nur ich** (Standard) | Gast sieht/hört zu, seine Bedienelemente sind gesperrt |
| **Gemeinsam** | Host und Gast steuern beide |
| **Komplett übergeben** | Nur der Gast steuert; beim Host ist das Studio gesperrt, „Steuerung zurückholen“ geht immer |

Der Gast kann die Steuerung **anfragen** (Session-Seite oder Hinweis im Studio); der Host bestätigt mit „Gemeinsam“ oder „Komplett übergeben“.
Freigegeben werden ausschließlich die Befehle der Allowlist: Play/Stop/Fortsetzen, Tempo, Loop, Link, Lautstärke, Panorama, Clip starten.
**Keine** Maus-/Tastatursteuerung, kein Löschen, kein Dateizugriff. Bei Verbindungsabbruch fällt die Steuerung sofort an den Host zurück.

Der Gast sieht auf *Studio* den Live-Status des Hosts (Transport, Tempo, Spuren), seine Befehle laufen über die Session und werden beim
Host aus Live zurückgelesen.

## Video, Sprache und DAW-Ton

* Kamera und Mikrofon starten beim Verbinden; Geräteauswahl, Stummschalten und Videoqualität auf der Session-Seite.
  Außerhalb der Session-Seite bleibt ein kleines Videofenster sichtbar.
* **Bildschirm + DAW-Ton** überträgt den Bildschirm (z. B. das Ableton-Fenster) und den Windows-Systemton auf **eigenen Spuren** – getrennt
  vom Mikrofon. So hört der Gast den Ableton-Mix, und das Mikrofon wird nicht doppelt gesendet.
* **Kopfhörer verwenden.** Sonst gelangt die Stimme des Partners aus den Lautsprechern in den Systemton. Wo die WebView es unterstützt,
  wird die Wiedergabe von Connect Studio selbst aus dem Systemton ausgeschlossen (`restrictOwnAudio`) – das ist unter Windows noch nicht getestet.
* Mikrofon nicht zusätzlich über Live auf den Master routen, sonst ist es im DAW-Ton doppelt.
* ASIO: Live darf weiter ein ASIO-Interface nutzen; der Systemton wird über das Windows-Standardausgabegerät erfasst. Hören Sie über ein
  ASIO-Interface ohne Windows-Ausgabe, ist der Systemton stumm – dann im Treiber des Interfaces einen Loopback/„Mix to Windows“ aktivieren
  oder in Live ein Windows-Ausgabegerät wählen. (Ein eigener ASIO-Capture-Dienst ist für Sprint 3 geplant.)

## Samples austauschen

Dateien **irgendwo ins Fenster ziehen** (oder *Samples → Dropzone*). Erlaubt: WAV, AIFF, MP3, FLAC, MIDI bis 2 GB.
Der Empfänger nimmt jedes Angebot ausdrücklich an. Die Datei wird direkt (Ende-zu-Ende verschlüsselt) übertragen, mit SHA-256 geprüft und im
sicheren Empfangsordner `Dokumente\LOCK-O-MOTIV Connect Studio\Empfangen` abgelegt – nie überschrieben, nie geöffnet oder ausgeführt.
Bei Abbruch: *Erneut senden* – der Empfang setzt an der unterbrochenen Stelle fort.

**Ins Projekt übernehmen** kopiert die Datei nach `<Ableton-Projekt>\Samples\Imported\Connect Studio\`. Der Projektordner muss eine
`.als`-Datei enthalten. In Live erscheint die Datei im Browser unter dem Projekt und kann von dort in eine Spur gezogen werden.

## Projekt-Hub: Ideen und Planer

* **Festhalten**: Idee oder Aufgabe eintippen, Enter. Optional wird das aktuelle Live-Tempo angehängen.
* **Board**: Ideen → Zu erledigen → In Arbeit → Fertig; Karten mit ◀ ▶ verschieben, Zuständigkeit wählen, bearbeiten (✎), löschen.
* **Vorlage „Track fertigstellen“**: zehn Schritte von Skizze bis Export als Aufgaben.
* Der Hub funktioniert auch **ohne Session**; alles wird lokal gespeichert und bei der nächsten Session mit dem Partner abgeglichen.
  Gleichzeitige Änderungen löst der Hub automatisch (letzte Änderung gewinnt, auf beiden Seiten gleich). Gelöschtes bleibt gelöscht.
