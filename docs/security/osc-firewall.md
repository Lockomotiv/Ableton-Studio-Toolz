# AbletonOSC nur lokal erreichbar machen

**Befund:** AbletonOSC (Commit `0ca6821`) bindet seinen Empfangsport an `0.0.0.0:11000`
(`abletonosc/osc_server.py`, Standardargument `local_addr`). Ohne Firewall kann damit **jeder Rechner im
selben Netz Ihr Live-Set steuern** – inklusive Spuren löschen (`/live/song/delete_track`). AbletonOSC hat
keine Authentifizierung.

Connect Studio selbst sendet und empfängt ausschließlich über `127.0.0.1`. Den Port von AbletonOSC
kann Connect Studio jedoch nicht selbst einschränken, ohne AbletonOSC zu verändern.

## Empfohlene Maßnahme (Windows 11)

1. Wenn Windows beim ersten Start von Live mit AbletonOSC fragt, ob *Ableton Live* in Netzwerken
   kommunizieren darf: **Abbrechen** bzw. keine Netzwerke erlauben (sofern Sie Live sonst nicht im Netz
   benötigen, z. B. für Ableton Link – Link nutzt andere Ports).
2. Zusätzlich eine eingehende Sperrregel für UDP 11000 anlegen (PowerShell **als Administrator**):

   ```powershell
   New-NetFirewallRule -DisplayName "AbletonOSC: UDP 11000 nur lokal" `
     -Direction Inbound -Protocol UDP -LocalPort 11000 -Action Block -Profile Any
   ```

   Die Windows-Firewall filtert Loopback-Verkehr (127.0.0.1) standardmäßig nicht, daher bleibt die
   lokale Steuerung durch Connect Studio möglich. **Bitte danach in Connect Studio → Diagnose prüfen,
   dass „AbletonOSC-Verbindung“ weiterhin OK ist** (auf Ihrem System nicht von uns getestet).

   Entfernen: `Remove-NetFirewallRule -DisplayName "AbletonOSC: UDP 11000 nur lokal"`

## Was die Diagnose prüft

`osc_exposure` liest `netstat -ano -p UDP` und meldet eine **Warnung**, wenn ein Prozess auf
`0.0.0.0:11000` oder `[::]:11000` lauscht. Diese Warnung bleibt auch mit Firewall-Regel bestehen, weil
die Bindung selbst unverändert ist – die Prüfung kann die Wirksamkeit der Firewall-Regel nicht feststellen.

## Langfristige Lösung (offen)

Ein Upstream-Vorschlag an AbletonOSC für eine konfigurierbare Bind-Adresse (Standard `127.0.0.1`)
oder eine von Connect Studio mitgelieferte, geprüfte Konfiguration. Bis dahin gilt die Firewall-Regel.
