# FamilyHub 3

Termine, Aufgaben und Einkäufe der ganzen Familie – an einem Ort, per Sprache eintragbar.

```
familyhub/
├── web/        Oberfläche (wird in die App gepackt und vom Server ausgeliefert)
├── server/     FamilyHub-Server für den Pi (Node.js, keine Abhängigkeiten)
├── android/    Android-App (WebView + native Spracherkennung, Widget, Erinnerungen)
├── Dockerfile, docker-compose.yml
└── release/    fertige APK
```

## Was ist neu gegenüber 2.0.3?

| Bisher (2.0.3) | Jetzt (3.0) |
|---|---|
| App war nur eine Hülle, die die Seite vom Pi geladen hat. Ohne Pi: leerer Bildschirm. | Oberfläche steckt in der App. Funktioniert sofort, auch offline. Der Pi gleicht nur die Daten ab. |
| Spracheingabe über das Mikrofon der Webseite | Androids eingebaute Spracherkennung (Deutsch, auch offline mit Sprachpaket) und ein Sprachverständnis, das Datum, Uhrzeit, Personen, Wiederholung, Erinnerung und Art (Termin/Aufgabe/Einkauf) erkennt |
| Startbildschirm = Verbindungs-Panel | Startbildschirm = „Heute“. Pi & Dienste liegen unter „Mehr“ |
| Widget zeigte nur Zahlen | Widget zeigt die nächsten Termine und fällige Aufgaben, mit Mikrofon- und Plus-Taste |
| Erinnerung: „Eine geplante Erinnerung ist fällig“ | Erinnerung mit echtem Titel und Uhrzeit |
| 7,8 MB | 0,13 MB |

### Bereiche

* **Heute** – Begrüßung, Schnelleingabe, „Als Nächstes“ mit Countdown, heutige Termine, fällige Aufgaben, Morgen, Einkaufsliste in Kurzform
* **Kalender** – Monatsansicht mit Farbpunkten pro Person, Tagesliste, Listenansicht; Serientermine, mehrtägige Termine
* **Aufgaben** – gruppiert nach Überfällig / Heute / Morgen / 7 Tage / Später / Ohne Datum; wiederkehrende Aufgaben springen beim Abhaken automatisch weiter (mit Serien-Zähler 🔥)
* **Einkauf** – automatisch nach Bereichen sortiert (Obst & Gemüse, Kühlregal …), „Im Wagen“, „Nochmal“-Leiste für häufige Artikel
* **Mehr** – Familie (Farben, Symbole, Spitznamen für die Sprache), Kindermodus mit Eltern-PIN, Fotos (Immich), Pi & Dienste (Status, Starten/Stoppen über die bisherige Pi-Verwaltung mit 8-stelligem Code, CasaOS, Tailscale), Synchronisierung, Einstellungen, Sprachbefehle

Überall gilt: **Rückgängig** nach jedem Speichern/Löschen/Abhaken, Personenfilter oben, Hell/Dunkel automatisch.

### Neu in 3.1 (angelehnt an den Dæly Calendar)

* **Ämterplan mit Sternen** – wiederkehrende Ämter pro Kind (bestimmte Wochentage, auf Wunsch wöchentlich wechselnd); Abhaken gibt Sterne, mit Konfetti 🎉
* **Routinen** – Morgen-/Abendroutine Schritt für Schritt (Vorlagen dabei), Fortschrittsring, Bonus-Sterne bei Abschluss
* **Belohnungstafel** – Eltern legen Belohnungen fest („30 Min. Tablet = 10 ⭐“), Kinder sehen ihren Fortschritt; Einlösen im Kindermodus nur mit Eltern-PIN; Sterne-Verlauf, Bonus/Abzug
* **Essensplan & Rezepte** – Wochenplan (Frühstück/Mittag/Abend wählbar), Rezeptsammlung, Zutaten der Woche mit einem Tipp auf die Einkaufsliste; per Sprache: „Am Freitag gibt es Pizza zum Abendessen“
* **Kalender verbinden** – Google, Apple iCloud, Outlook, Schul-/Ferien-/Müllkalender per iCal-Adresse (Anleitung in der App), farbig, alle 30 Min. aktualisiert
* **Wochenansicht** im Kalender (auf Tablets als 7 Spalten)
* **Wandansicht / Bilderrahmen** – große Uhr, Tagesplan je Person, Essen, Kinder-Fortschritt, Diashow aus Immich; startet auf Wunsch automatisch nach x Minuten (Bildschirm bleibt an)
* **Hinweis bei Zuteilung** – trägt jemand anderes dir einen Termin, eine Aufgabe oder ein Amt ein, kommt eine Benachrichtigung

### Neu in 3.2: Rezepte von Chefkoch & Cookidoo, Ernährungscoach

* **Rezept-Import per Link oder „Teilen → FamilyHub“** aus Chefkoch, Cookidoo (Thermomix), EatSmarter, Lecker, Kitchen Stories, Essen & Trinken, BBC Good Food und allen Seiten mit schema.org-Rezeptdaten: Foto, Zutaten, Schritte, Portionen, Zeit und – wo vorhanden – Nährwerte
* **Portionsrechner** – Mengen werden umgerechnet („500 g“ → „750 g“ bei 6 statt 4 Portionen)
* **Ernährungscoach** – Wochen-Balance (0–100) nach den DGE-Empfehlungen: Fleisch, Fisch, vegetarisch, Gemüse, Hülsenfrüchte, Abwechslung, optional kcal-Ziel; konkrete Tipps und passende Ideen
* **Ideen** – eigener Pool mit 50 Familiengerichten, abgestimmt auf die Lücken der Woche, plus Suche direkt bei Chefkoch, Cookidoo, EatSmarter, Lecker und Kitchen Stories
* **„Offene Tage mit Ideen füllen“** – plant den Rest der Woche ausgewogen vor (eigene Rezepte zuerst)

Hinweis zu Cookidoo und Lifesum: Beide bieten keine offene Schnittstelle. Öffentliche Cookidoo-Rezeptseiten lassen sich importieren
(Zutaten zeigt Cookidoo teils nur angemeldet), „In Cookidoo öffnen“ springt zurück ins Original. Lifesum ersetzt der eingebaute Coach.

### Neu in 3.3: Sprachsteuerung beantwortet Fragen und hakt ab

* Fragen: „Was steht heute an?“, „Was hat Lena morgen?“, „Wann ist der Elternabend?“, „Was gibt es heute zu essen?“,
  „Was steht auf der Einkaufsliste?“, „Wie viele Sterne hat Ben?“, „Was muss Ben heute noch machen?“ – Antwort wird vorgelesen
* Erledigt melden: „Lena hat den Tisch gedeckt“ (+ Sterne), „Steuererklärung ist erledigt“, „Milch ist gekauft“
* Dasselbe über die Server-API `POST /api/v2/quick` – z. B. für Home Assistant, Google-Routinen oder Siri-Kurzbefehle

### Sprachsteuerung – Beispiele

* „Morgen um halb vier Zahnarzt mit Lena, erinnere mich eine Stunde vorher“
* „Fußball jeden Dienstag von 17 bis 18:30 Uhr für Ben“
* „Papa muss morgen den Müll rausbringen“
* „Milch, Eier und Brot auf die Einkaufsliste“
* „Oma Geburtstag am 14. März“ (ganztägig, jährlich)

Mikrofon-Taste unten rechts (lang drücken = tippen), im Widget oder App-Symbol lang drücken → „Sprechen“.
Unter *Einstellungen* lässt sich „Direkt speichern“ einschalten – dann wird ohne Rückfrage eingetragen und kurz vorgelesen.

## Installation auf dem Handy

1. `release/FamilyHub-3.3.0.apk` aufs Handy und installieren.
   Die neue App hat eine eigene Paket-ID (`de.familyhub.app`) und läuft **neben** der alten App. Die alte kann gelöscht werden, sobald alles passt.
2. Beim ersten Start „Familie anlegen“.
3. Optional: Mehr → Synchronisierung → mit dem Pi verbinden (siehe unten).

## Server auf dem Pi

```bash
# auf dem Pi, im Ordner familyhub/
docker compose up -d --build
```

Der Server läuft dann unter `http://<pi>:8446/` (Browser-Version inklusive). In der App:
*Mehr → Synchronisierung*, Adresse `http://192.168.178.51:8446/` eintragen und ein Familien-Passwort festlegen
(beim ersten Verbinden wird es gesetzt). Weitere Handys melden sich mit demselben Passwort an.
Bisher nur lokal erfasste Einträge werden dabei automatisch hochgeladen.

* Daten: `./data/familyhub.json`, tägliche Sicherungen in `./data/backups/` (30 Tage)
* Unterwegs: Tailscale am Handy an → die App wechselt automatisch auf `http://autodartspi.tail318476.ts.net:8446/`
  (Tailscale verschlüsselt selbst, http ist dort unkritisch). Für HTTPS `TLS_CERT`/`TLS_KEY` setzen, z. B. mit `tailscale cert`.
* Kalender-Abo (Google/Apple/Outlook): *Mehr → Synchronisierung → Kalender abonnieren*
* Fotos für die Wandansicht: in `docker-compose.yml` `IMMICH_URL` und `IMMICH_API_KEY` setzen (der Schlüssel bleibt auf dem Pi)

### API (für Home Assistant, Siri-Kurzbefehle, Google-Routinen, Tasker …)

```
POST /api/v2/quick      {"text": "Morgen 15 Uhr Zahnarzt mit Lena"}   → legt den Eintrag an
                        {"text": "Was steht heute an?"}              → {command:'answer', speak:'Heute sind …'}
POST /api/v2/parse      {"text": "…"}                                  → nur verstehen, nichts speichern
GET  /api/v2/state      ?since=<rev>                                   → alle Daten
POST /api/v2/batch      {"ops":[{"op":"put","col":"tasks","item":{…}}]}
GET  /api/v2/calendar.ics?key=…                                        → iCal-Feed
GET  /healthz
```
Anmeldung: `POST /api/v2/login {"password": "…"}` → `{"token": "…"}`, danach Header `Authorization: Bearer <token>`.

## Entwicklung

```bash
cd server && npm test                         # Sprachverständnis + Server-Tests
cd server && node server.js                   # http://localhost:8080
cd android && gradle assembleRelease          # braucht Android-SDK; Signatur über android/keystore.properties
```

`android/keystore.properties` und der Schlüssel (`*.jks`) gehören **nicht** ins Repository.
Ohne denselben Schlüssel lassen sich spätere Versionen nicht als Update über die installierte App spielen.
