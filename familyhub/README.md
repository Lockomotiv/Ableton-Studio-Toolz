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

### Neu in 4.0 (Abgleich mit FamilyWall)

* **Pinnwand** – Familien-Nachrichten mit Anheften und Reaktionen, Benachrichtigung bei neuen Nachrichten
* **Kontakte** – Kinderarzt, Kita, Babysitter … nach Bereichen, Anruf/SMS/E-Mail/Karte mit einem Tipp, Notrufnummern
* **Listen** – eigene Listen (Packliste mit Vorlage, Geschenkideen, Filme, Bücher …)
* **Stundenplan** – je Kind, erscheint auf „Heute“, per Sprache abfragbar
* **Haushaltsbuch** – Ausgaben & Einnahmen, Kategorien, Monatslimits mit Warnung, Hochrechnung
* **Dokumente** – Impfpass, Verträge, Zeugnisse als PDF/Foto, gespeichert auf dem Pi (nicht in einer fremden Cloud)
* **Teilen → FamilyHub** mit Text (z. B. aus einer Termin-E-Mail) → wird als Termin erkannt
* Neue Sprachbefehle: „35 Euro bei Rewe ausgegeben“, „Schreib an die Pinnwand: …“, „Was hat Lena morgen in der Schule?“
* Bewusst nicht umgesetzt: **Live-Ortung** der Familie (bräuchte dauerhaftes GPS im Hintergrund – Akku & Datenschutz)

### Neu in 4.1: Abfall

* **Abfall** (*Mehr → Abfall*): nächste Abholung je Tonne (Restmüll, Bio, Gelber Sack, Papier, Glas, Grünschnitt, Sperrmüll, Schadstoffe) mit Countdown
* Abholtermine erscheinen farbig im **Kalender**, auf **Heute** („morgen – heute Abend rausstellen“), im **Widget** und in der **Wandansicht**
* **Erinnerung am Vorabend** (Uhrzeit einstellbar), **Zuständigkeit** je Tonne („Ben stellt raus“)
* Sprache: „Welcher Müll kommt morgen?“, „Wann kommt die Biotonne?“ – auch über die Pi-API
* Quelle: Abo-Link (iCal/ICS/webcal) des Entsorgers, Google-Kalender (Link, Kalender-ID oder „Privatadresse im iCal-Format“) oder eine .ics-Datei

  Hinweis: Ein in Google *per URL abonnierter* Kalender (`…@import.calendar.google.com`) ist nur im eigenen Google-Konto sichtbar –
  Google liefert dafür keine öffentliche iCal-Adresse (404/401). Dann den ursprünglichen Abo-Link des Entsorgers verwenden.

### Neu in 4.3: Einkauf mit Läden, Bildkacheln und Stammartikeln

* **Läden:** Marktkauf, Rewe, Edeka, Lidl, Aldi, Rossmann – Liste pro Laden (in Markenfarben), Artikel ohne festen Laden erscheinen überall.
  Hygiene & Pflege landet automatisch bei **Rossmann**; jeder Artikel merkt sich seinen Laden.
* **Auswahl per Bildkachel:** über 300 gängige Artikel (Wocheneinkauf, Haushalt, Hygiene, Reinigung, Baby, Tier) in 17 Bereichen,
  „Häufig“ lernt mit, Mengen per Antippen. Unbekanntes einfach eintippen → wird eingeordnet und als eigene Kachel gemerkt.
* **Wiederkehrende Einkäufe:** pro Artikel „jede Woche / alle 2 Wochen / jeden Monat“ – fällige Stammartikel mit einem Tipp auf die Liste.
* **Prospekte:** pro Laden der offizielle Prospekt mit einem Tipp, Angebote markieren, „Angebote für diesen Artikel suchen“.
  Eine automatische Übernahme der Prospekt-Inhalte ist nicht möglich: Die Händler bieten keine Schnittstelle an, und das Auslesen
  ihrer Seiten verstößt gegen deren Nutzungsbedingungen.

### Neu in 4.4: Wetter mit Anzieh-Assistent

* **Wetter** für Lübben (Spreewald) – Ort änderbar (Suche nach Ort/PLZ), gilt für die ganze Familie
* Animierte Wetterszenen (Sonne, Mond & Sterne, Wolken, Regen, Schnee, Gewitter, Nebel) auf „Heute“, in der Rubrik *Wetter* und in der Wandansicht
* Aktuell, gefühlt, Tageshöchst/-tiefst, **24 Stunden**, **7 Tage**, Wind & Böen, Luftfeuchte, Luftdruck, UV-Index, Sonnenauf-/-untergang,
  Niederschlag & Schnee, **Luftqualität**, **Pollenflug**, **Unwetterwarnungen des DWD**
* **Anzieh-Assistent** je Person (Kinder bekommen eigene Regeln, z. B. Matschhose, Sonnenhut LSF 50, Wechselsachen) für heute,
  morgen und übermorgen – mit Begründung, Zwiebellook-, Regen-, Glätte-, Sturm- und Pollenhinweisen; Vorlesen per Knopf
* Sprache & Siri: „Wie wird das Wetter morgen?“, „Was soll Lena anziehen?“, „Brauche ich einen Schirm?“
* iPhone: morgens um 06:45 Uhr Anziehtipp als Benachrichtigung vom Pi
* Daten: Open-Meteo (CC BY 4.0, ohne Schlüssel), Warnungen: Deutscher Wetterdienst über Bright Sky

### Neu in 4.5: Premium-Oberfläche
Überarbeitet nach den Design-Skills `anthropics/skills › frontend-design` und `dickwu/apple-design-skill` (Apple Human Interface Guidelines):
- **Symbole statt Emojis für Eltern & Erwachsene:** eine einheitliche Linien-Symbolsprache (Lucide, ISC-Lizenz) – Einkaufsartikel, Kategorien, Wetter, Anzieh-Tipps, Abfalltonnen, Haushaltsbuch, Kontakte, Listen, Ämter, Rezepte. Einkaufskacheln zeigen das Symbol in der Farbe ihres Bereichs.
- **Kinderprofil bleibt bunt:** im Kindermodus (und auf Handys, die einem Kind gehören) erscheinen weiter Emojis. Das Avatar-Emoji wählt ihr unter „Familie → Symbol im Kinderprofil“; Erwachsene sehen stattdessen ein Monogramm.
- **Auch Benachrichtigungen & Widget** sind für Erwachsene ohne Emojis (Push vom Pi, Erinnerungen, Startbildschirm-Widget).
- **Ruhigere Gestaltung:** kühles Neutral statt Creme, Spreewald-Petrol nur für Aktionen und Status, Koralle ausschließlich für die Sprachtaste. Überschriften in Satzschreibung mit Zähl-Pillen statt VERSALIEN, feine Kanten statt Farbflächen, gruppierte Menüs wie in den Systemeinstellungen, Glas-Effekt nur für Kopf- und Tab-Leiste.
- **Schrift:** Manrope (OFL, liegt in der App) für Überschriften und Zahlen, Systemschrift für Text und Bedienelemente. Hell & Dunkel geprüft, Kontraste ≥ 4,5:1 für Text.

### Neu in 4.6: Aufgaben & Belohnungen im Vordergrund
- **Dashboard der Eltern:** Karte „Ämter & Sterne“ direkt unter den Kennzahlen – je Kind ein Ring mit dem Tagesfortschritt, der Sternestand, ein Zielbalken zur nächsten Belohnung („Noch 2 bis Eis essen gehen“), eine Mini-Wochenkurve und die Serie (🔥 Tage in Folge alles erledigt).
- **Dashboard des Kindes:** großer Sternezähler ganz oben, Belohnungsziel mit Bild und dickem Fortschrittsbalken, Sterne der Woche als Balken, die heutigen Ämter als große Kacheln zum direkten Abhaken und die Routinen mit Fortschrittsring.
- **Wochenplan (neuer Reiter unter Aufgaben):** wer an welchem Tag welches Amt hat – als Raster Ämter × Wochentage, abhakbar; oben die Verteilung der Woche (Anteil je Person, erledigt, mögliche Sterne). Verpasste Ämter erscheinen gestrichelt.
- **Im Kalender:** Monatsansicht mit kleinem Ämter-Balken je Tag (gelb = teilweise, grün = alles erledigt), Tagesansicht mit den Ämtern zum Abhaken, Wochenansicht mit „2/3 Ämter“ je Person und Aufgaben samt Sternen; die Listenansicht zeigt jetzt auch Aufgaben.
- **Sterne für Aufgaben:** im Aufgaben-Editor „Sterne bei Erledigung“ – beim Abhaken (auch per Sprache/Siri über den Pi) bekommen die eingetragenen Personen die Sterne; Wiederöffnen bucht sie zurück.
- **Animationen:** Sterne fliegen vom abgehakten Amt zum Sternezähler (oder zum Aufgaben-Tab), der Zähler zählt hoch, Ringe und Balken wachsen. Wird eine Belohnung erreichbar, erscheint „Ziel erreicht“ mit Konfetti. Belohnungen, die eingelöst werden können, leuchten. Der Aufgaben-Tab zeigt, wie viel heute noch offen ist; Kinder landen dort direkt bei ihren Ämtern. Bei „Bewegung reduzieren“ entfallen die Animationen.

### 4.6.1: Fotos in der Android-App
- Fotos und Diashow laden in der Android-App jetzt über die App selbst. Vorher blieben die Kacheln leer, weil die App-Oberfläche (https) Bilder vom Pi (http) nicht direkt laden durfte.
- Kommen Bilder trotzdem nicht an, sagt die Fotoseite warum – z. B. wenn dem Immich-API-Schlüssel das Recht „asset.view“ fehlt (nötig für Vorschaubilder).

### 4.6.2: Familien-Diashow als Standard
- Die Diashow zeigt standardmäßig das Immich-Album **„Familien-Diashow“** (wird automatisch gefunden; auch „Familie Diashow …“ o. ä.). Gibt es keins, laufen zufällige Fotos.
- *Mehr → Fotos → Zahnrad (Diashow)*: unter „Familien-Diashow“ seht ihr, welches Album aktiv ist, und könnt für die ganze Familie andere Alben festlegen (oder zurück auf „Automatisch“).
- Pro Gerät lässt sich weiterhin eine eigene Quelle wählen (Zufällig, Favoriten, An diesem Tag, Neueste, ausgewählte Alben). Solange auf einem Gerät nichts gewählt wurde, gilt der Familien-Standard.

### Sprachsteuerung – Beispiele

* „Morgen um halb vier Zahnarzt mit Lena, erinnere mich eine Stunde vorher“
* „Fußball jeden Dienstag von 17 bis 18:30 Uhr für Ben“
* „Papa muss morgen den Müll rausbringen“
* „Milch, Eier und Brot auf die Einkaufsliste“
* „Oma Geburtstag am 14. März“ (ganztägig, jährlich)

Mikrofon-Taste unten rechts (lang drücken = tippen), im Widget oder App-Symbol lang drücken → „Sprechen“.
Unter *Einstellungen* lässt sich „Direkt speichern“ einschalten – dann wird ohne Rückfrage eingetragen und kurz vorgelesen.

## Installation auf dem Handy

1. `release/FamilyHub-4.6.3.apk` aufs Handy und installieren.
   Die neue App hat eine eigene Paket-ID (`de.familyhub.app`) und läuft **neben** der alten App. Die alte kann gelöscht werden, sobald alles passt.
2. Beim ersten Start „Familie anlegen“.
3. Optional: Mehr → Synchronisierung → mit dem Pi verbinden (siehe unten).

## iPhone (iOS 16.4 oder neuer)

FamilyHub läuft auf iPhones als **Web-App direkt vom Pi** – ohne App Store, ohne Mac. Alle sehen dieselben Daten wie die Android-Handys.

1. Auf dem iPhone die App **Tailscale** installieren und anmelden (sichere https-Adresse – nötig für Mikrofon & Benachrichtigungen).
   Auf dem Pi beim Installieren „HTTPS über Tailscale“ mit **j** bestätigen (`./install-pi.sh`).
2. In **Safari** öffnen: `https://<pi-name>.<tailnet>.ts.net:8446/`
3. **Teilen ⬆︎ → „Zum Home-Bildschirm“** → vom Home-Bildschirm öffnen
4. Anmelden (Familien-Passwort), unter *Familie* „Wer nutzt dieses Handy?“ wählen
5. *Mehr → iPhone & Browser* → **Benachrichtigungen einschalten**

Benachrichtigungen schickt der Pi selbst (Web Push, VAPID, verschlüsselt nach RFC 8291): Erinnerungen an Termine & Aufgaben,
Abfall am Vorabend, neue Pinnwand-Nachrichten und neue Einträge für die Person. **„Hey Siri, FamilyHub“**: unter
*iPhone & Browser → Siri-Kurzbefehl einrichten* stehen URL und Schlüssel zum Kopieren und die Schritte für die Kurzbefehle-App.

Eine echte App aus dem App Store bräuchte einen Mac mit Xcode und ein Apple-Entwicklerkonto (99 €/Jahr).

## Installation auf dem Pi (Datenbank + Immich)

```bash
git clone https://github.com/Lockomotiv/Ableton-Studio-Toolz.git
cd Ableton-Studio-Toolz/familyhub
./install-pi.sh
```

Das Skript
1. prüft Docker (bei CasaOS schon vorhanden),
2. **findet Immich auf dem Pi automatisch** (Container `immich_server`) und fragt nach dem Immich-API-Schlüssel
   (Immich → Profilbild → Kontoeinstellungen → API-Schlüssel; Rechte `asset.read`, `asset.view`, `album.read`) –
   der Schlüssel kann auch später in der App eingetragen werden (*Mehr → Fotos*) und bleibt immer auf dem Pi,
3. startet FamilyHub auf Port **8446** mit **SQLite-Datenbank** in `./data/familyhub.sqlite`
   (WAL-Journal, tägliche Sicherung nach `./data/backups/`, 30 Tage),
4. richtet auf Wunsch HTTPS für unterwegs über Tailscale ein.

Danach in der App: *Mehr → Synchronisierung* → `http://<Pi-IP>:8446/` → Familien-Passwort festlegen.
Bestehende Daten aus FamilyHub 3.x (`familyhub.json`) werden beim ersten Start automatisch in die Datenbank übernommen.

Update: `./install-pi.sh update` · Status: `./install-pi.sh status`

### Von unterwegs ohne Tailscale (z. B. älteres iPad mit iOS 15)
Tailscale läuft nicht auf jedem Gerät. Zwei Wege ohne Tailscale:

**A) Eigene Internet-Adresse mit HTTPS** – funktioniert in jedem Browser, auch auf iPads mit iOS 15:
```bash
./install-pi.sh internet        # einrichten (fragt nach eurer MyFRITZ!- oder DuckDNS-Adresse)
./install-pi.sh internet aus    # wieder abschalten
```
- Startet einen Caddy-Container (`familyhub-https`), der automatisch ein Let's-Encrypt-Zertifikat holt.
- Einmalig in der FRITZ!Box: *Internet → Freigaben → Portfreigaben* → Pi → Portfreigabe TCP **extern 443 → Port 8447**.
- Danach am iPad: Safari → `https://eure-adresse/` → Teilen → „Zum Home-Bildschirm“. In den Android-Apps unter *Mehr → Synchronisierung* als Adresse „Mobil“ eintragen.
- FamilyHub ist dann aus dem Internet erreichbar: ein starkes Familien-Passwort wählen. Fehlversuche werden pro Absender gebremst (10 in 15 Minuten).

**B) VPN der FRITZ!Box (WireGuard)** – nichts ist öffentlich erreichbar: In der FRITZ!Box unter *Internet → Freigaben → VPN (WireGuard)* eine Verbindung für das iPad anlegen, QR-Code mit der App „WireGuard“ (läuft ab iOS 15) scannen. Unterwegs VPN an und `http://<Pi-IP>:8446/` öffnen. Achtung: Hat das fremde WLAN ebenfalls 192.168.178.x, empfiehlt AVM, das Heimnetz auf einen anderen Bereich umzustellen.

Hinweis iOS 15: Termine, Aufgaben, Einkauf, Fotos und Diashow funktionieren. Benachrichtigungen bietet Apple für Web-Apps erst ab iOS 16.4.

### Fotos & Diashow
* **Fotos** (*Mehr → Fotos*): Galerie aus Immich – Zufällig, Favoriten, „An diesem Tag“, Neueste, einzelne Alben; Vollbild mit Wischen
* **Diashow / Bildschirmschoner**: startet nach **1 Minute** ohne Bedienung (einstellbar: Aus, 1, 2, 5, 10, 30 Min.)
* Einstellungen (*Fotos → ⚙*): Fotoquelle inkl. Alben-Auswahl, Wechselintervall, Animation (Ken Burns, Überblenden, Schieben, Zoom, abwechselnd),
  Anzeige (Uhr + Tagesplan, nur Uhr, nur Fotos), Datum & Ort einblenden („23. Juli 2021 · vor 5 Jahren · Graz“)

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
