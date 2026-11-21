# Verbindungsdienst selbst hosten (Internet-Sessions)

Für Sessions im **lokalen Netz** ist nichts zu tun – Connect Studio bringt den Signalisierungsdienst mit.
Für Sessions **über das Internet** braucht es einen erreichbaren Signalisierungsdienst. Es gibt bewusst keinen
zentralen Dienst des Projekts; Sie betreiben ihn selbst (kostenlos nutzbare Software, kein Abo).

## Was der Dienst sieht

* Der Signalisierungsdienst vermittelt nur den Verbindungsaufbau (Raum-ID, WebRTC-Angebote, ICE-Kandidaten mit IP-Adressen).
* Er speichert vom Einladungsgeheimnis nur den SHA-256-Hash, nimmt maximal zwei Teilnehmer je Raum an und löscht leere Räume sofort.
* **Video, Ton, Steuerbefehle, Hub-Einträge und Samples laufen nie über ihn** – sie gehen direkt und DTLS-verschlüsselt zwischen den Teilnehmern
  oder, falls direkt nicht möglich, verschlüsselt über Ihren TURN-Server.
* Der Sicherheitscode in der Session zeigt, ob ein manipulierter Server sich dazwischengeschaltet hat.

## Variante A: Docker Compose (empfohlen)

Voraussetzungen: ein kleiner Linux-Server (1 vCPU, 1 GB RAM genügen) mit öffentlicher IP, eine Domain mit A-Record darauf,
Docker mit Compose. Offene Ports: 80/443 TCP (Caddy/TLS), 3478 TCP+UDP (STUN/TURN), 49160–49200 UDP (TURN-Relay).

```bash
git clone https://github.com/lockomotiv/ableton-studio-toolz.git
cd ableton-studio-toolz/services/signaling/deploy
cp .env.example .env
# .env bearbeiten: SIGNAL_DOMAIN, TURN_DOMAIN, PUBLIC_IP und TURN_SECRET (openssl rand -hex 32)
docker compose up -d --build
```

In Connect Studio unter *Einstellungen → Zusammenarbeit*: Signalisierungsserver `wss://<SIGNAL_DOMAIN>` eintragen.
TURN-Zugangsdaten müssen Sie **nicht** eintragen – der Dienst stellt jedem Teilnehmer zeitlich begrenzte Zugangsdaten
aus (coturn „use-auth-secret“, 12 h gültig). Das TURN-Geheimnis verlässt den Server nie.

Komponenten und Lizenzen: lom-signaling (MIT, dieses Projekt), Caddy (Apache-2.0), coturn (BSD-3-Clause).

## Variante B: nur das Programm

```bash
cargo build --release -p lom-signaling
LOM_TURN_SECRET=… ./target/release/lom-signaling --bind 127.0.0.1:8787 \
  --stun stun:turn.example.org:3478 --turn "turn:turn.example.org:3478?transport=udp"
```

TLS über einen beliebigen Reverse-Proxy (Caddy, nginx, Traefik) mit WebSocket-Weiterleitung auf 127.0.0.1:8787.
Ohne `--turn` werden nur STUN-Angaben verteilt (funktioniert bei den meisten Heimroutern, nicht bei strikten Firmen-NATs).

## Ohne eigenen Server

* Beide im selben Netz/VPN (z. B. WireGuard, Tailscale): LAN-Modus genügt.
* Portweiterleitung TCP 47870 auf den Host-Rechner und den LAN-Modus verwenden – die Einladung enthält dann aber die lokale Adresse;
  die öffentliche Adresse müsste von Hand eingetragen werden. Nicht empfohlen (unverschlüsselter Verbindungsaufbau, Connect Studio warnt).

## Prüfen

```bash
# WebSocket erreichbar? (erwartet: {"type":"error","code":"bad-request",...} nach 10 s oder bei falscher Nachricht)
npx wscat -c wss://signal.mein-studio.de
```
In einer Session zeigt *Verbindung → Weg* „Über TURN-Relay“, wenn TURN verwendet wird.
