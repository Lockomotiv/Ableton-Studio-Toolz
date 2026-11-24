#!/usr/bin/env bash
# FamilyHub – Installation auf dem Raspberry Pi (oder jedem Linux mit Docker)
#
#   git clone https://github.com/Lockomotiv/Ableton-Studio-Toolz.git
#   cd Ableton-Studio-Toolz/familyhub
#   ./install-pi.sh            # Installation / Neustart mit Rückfragen
#   ./install-pi.sh update     # neueste Version holen und neu starten
#   ./install-pi.sh status     # Zustand anzeigen
#   ./install-pi.sh passwort   # Familien-Passwort vergessen → neu setzen
#   ./install-pi.sh internet   # Zugang von unterwegs ohne Tailscale (HTTPS über eigene Adresse)
#
# Was passiert:
#   1. prüft Docker (CasaOS bringt Docker bereits mit)
#   2. findet Immich auf diesem Pi und richtet die Verbindung ein (API-Schlüssel optional jetzt oder später in der App)
#   3. startet FamilyHub mit SQLite-Datenbank in ./data (tägliche Sicherungen in ./data/backups)
#   4. optional: HTTPS für unterwegs über Tailscale – oder ohne Tailscale: ./install-pi.sh internet
set -euo pipefail
cd "$(dirname "$0")"

B='\033[1m'; G='\033[32m'; Y='\033[33m'; R='\033[31m'; N='\033[0m'
say()  { printf "${B}%s${N}\n" "$*"; }
ok()   { printf "${G}✓${N} %s\n" "$*"; }
warn() { printf "${Y}!${N} %s\n" "$*"; }
die()  { printf "${R}✗ %s${N}\n" "$*"; exit 1; }
ask()  { local q="$1" def="${2:-}" a; read -r -p "$q${def:+ [$def]}: " a || true; echo "${a:-$def}"; }

SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null && SUDO="sudo"
DOCKER="docker"; if ! docker info >/dev/null 2>&1; then DOCKER="$SUDO docker"; fi
compose() { if $DOCKER compose version >/dev/null 2>&1; then $DOCKER compose "$@"; else $SUDO docker-compose "$@"; fi; }

lan_ip() {  # Heimnetz-IP bevorzugen, Docker-Netze (172.17+) ignorieren
  local all; all="$(hostname -I 2>/dev/null | tr ' ' '\n')"
  echo "$all" | grep -E '^192\.168\.' | head -1 || true
  [ -n "$(echo "$all" | grep -E '^192\.168\.')" ] || echo "$all" | grep -E '^10\.' | grep -vE '^10\.(0|1)\.' | head -1
}
ts_name() { command -v tailscale >/dev/null && tailscale status --json 2>/dev/null | grep -o '"DNSName": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/; s/\.$//'; }
env_get() { [ -f .env ] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
env_set() { touch .env; chmod 600 .env; if grep -qE "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else echo "$1=$2" >> .env; fi; }

status() {
  local port; port="$(env_get FAMILYHUB_PORT)"; port="${port:-8446}"
  if curl -fsS "http://127.0.0.1:$port/healthz" 2>/dev/null; then echo; ok "FamilyHub läuft auf Port $port"; else warn "FamilyHub antwortet nicht auf Port $port"; fi
  compose ps 2>/dev/null || true
}

# ---------- Zugang von unterwegs ohne Tailscale (z. B. für ältere iPads) ----------
internet() {
  if [ "${1:-}" = "aus" ] || [ "${1:-}" = "off" ]; then
    env_set COMPOSE_PROFILES ""; env_set TRUST_PROXY 0
    compose --profile internet stop https >/dev/null 2>&1 || true; compose --profile internet rm -f https >/dev/null 2>&1 || true
    compose up -d; ok "Zugang aus dem Internet ist ausgeschaltet. Router-Freigabe (443) bitte auch entfernen."; return
  fi
  say "FamilyHub von unterwegs – ohne Tailscale, mit HTTPS-Zertifikat"
  echo "Du brauchst eine Adresse, die immer auf euren Anschluss zeigt:"
  echo "  • FRITZ!Box: Internet → MyFRITZ!-Konto → eure MyFRITZ!-Adresse (z. B. abcd1234.myfritz.net)"
  echo "  • oder kostenlos bei duckdns.org (z. B. familie-xyz.duckdns.org)"
  local cur dom ext pub dns
  cur="$(env_get FH_DOMAIN)"
  dom="$(ask 'Adresse (ohne https://)' "$cur")"; dom="${dom#https://}"; dom="${dom#http://}"; dom="${dom%%/*}"
  [ -n "$dom" ] || die "Ohne Adresse geht es nicht."
  echo "$dom" | grep -qE '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' || die "„$dom“ sieht nicht wie eine Internet-Adresse aus."
  pub="$(curl -fsS -4 --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  dns="$(getent ahostsv4 "$dom" 2>/dev/null | awk 'NR==1{print $1}')"
  if [ -n "$pub" ] && [ -n "$dns" ] && [ "$pub" != "$dns" ]; then warn "$dom zeigt auf $dns, euer Anschluss hat aber $pub – DynDNS/MyFRITZ prüfen."
  elif [ -z "$dns" ]; then warn "$dom ist (noch) nicht auflösbar – bei MyFRITZ/DuckDNS prüfen."; else ok "$dom zeigt auf euren Anschluss"; fi
  env_set FH_DOMAIN "$dom"; env_set COMPOSE_PROFILES internet; env_set TRUST_PROXY 1
  mkdir -p data/caddy
  compose up -d --build
  echo
  say "Jetzt einmalig im Router freigeben (FRITZ!Box):"
  echo "  Internet → Freigaben → Portfreigaben → Gerät für Freigaben hinzufügen → diesen Pi ($(lan_ip)) wählen"
  echo "  → Neue Freigabe → Portfreigabe → „HTTPS-Server“ bzw. Protokoll TCP:"
  echo "       Port an Gerät: 8447    ·    Port extern gewünscht: 443"
  echo "  (Bei IPv6-Anschluss/DS-Lite zusätzlich „IPv6 freigeben“ anhaken.)"
  echo
  [ "$(ask 'Freigabe eingerichtet? Dann jetzt Zertifikat prüfen (j/n)' j)" = "j" ] || { warn "Später prüfen mit: ./install-pi.sh internet"; return; }
  echo "Warte auf das Zertifikat (bis zu 2 Minuten) …"
  for i in $(seq 1 24); do
    if curl -fsS --max-time 6 "https://$dom/api/v2/health" >/dev/null 2>&1; then ok "Erreichbar: https://$dom/"; echo; echo "  iPad/iPhone: Safari → https://$dom/ → Teilen → „Zum Home-Bildschirm“"; echo "  In der App: Mehr → Synchronisierung → https://$dom/"; return; fi
    sleep 5
  done
  warn "Noch nicht erreichbar. Häufige Ursachen: Freigabe fehlt, Anschluss ohne öffentliche IPv4 (DS-Lite) ohne IPv6-Freigabe."
  echo "  Protokoll ansehen: $DOCKER logs familyhub-https --tail 40"
}

touch .env; chmod 600 .env
case "${1:-install}" in
  status) status; exit 0 ;;
  update)
    say "Neueste Version holen …"
    git pull --ff-only || warn "git pull nicht möglich – lokale Version wird neu gebaut"
    mkdir -p data; $SUDO chown -R 1000:1000 data 2>/dev/null || true
    compose up -d --build
    sleep 3; status; exit 0 ;;
  internet) internet "${2:-}"; exit 0 ;;
  passwort|password)
    say "Familien-Passwort neu setzen"
    read -r -s -p "Neues Passwort (mind. 6 Zeichen): " P1; echo
    read -r -s -p "Noch einmal: " P2; echo
    [ "$P1" = "$P2" ] || die "Die beiden Eingaben sind verschieden."
    [ "${#P1}" -ge 6 ] || die "Mindestens 6 Zeichen."
    env_set FAMILYHUB_PASSWORD "$P1"
    compose up -d >/dev/null
    for i in $(seq 1 20); do sleep 2; curl -fsS "http://127.0.0.1:$(env_get FAMILYHUB_PORT | grep . || echo 8446)/healthz" >/dev/null 2>&1 && break; done
    sed -i '/^FAMILYHUB_PASSWORD=/d' .env   # nur einmal anwenden – gespeichert ist es jetzt in der Datenbank
    compose up -d >/dev/null
    ok "Neues Familien-Passwort ist gesetzt. Bereits angemeldete Geräte bleiben angemeldet."
    exit 0 ;;
esac

say "FamilyHub – Installation"
echo

# ---------- 1. Docker ----------
if ! command -v docker >/dev/null; then
  warn "Docker ist nicht installiert."
  [ "$(ask 'Docker jetzt installieren? (j/n)' j)" = "j" ] || die "Ohne Docker geht es nicht."
  curl -fsSL https://get.docker.com | $SUDO sh
  DOCKER="$SUDO docker"
fi
$DOCKER info >/dev/null 2>&1 || die "Docker läuft nicht (sudo systemctl start docker)."
ok "Docker bereit"

# ---------- 2. Port ----------
PORT="$(env_get FAMILYHUB_PORT)"; PORT="${PORT:-8446}"
PORT="$(ask 'Port für FamilyHub' "$PORT")"
env_set FAMILYHUB_PORT "$PORT"

# ---------- 3. Immich ----------
IMMICH_URL="$(env_get IMMICH_URL)"
if [ -z "$IMMICH_URL" ]; then
  # Immich-Container suchen (Standardname immich_server, bei CasaOS teils anders)
  IM_NAME="$($DOCKER ps --format '{{.Names}}' | grep -iE 'immich.?server|^immich$' | head -1 || true)"
  if [ -n "$IM_NAME" ]; then
    IM_PORT="$($DOCKER port "$IM_NAME" 2283/tcp 2>/dev/null | head -1 | sed 's/.*://')"
    [ -z "$IM_PORT" ] && IM_PORT="$($DOCKER port "$IM_NAME" 3001/tcp 2>/dev/null | head -1 | sed 's/.*://')"
    if [ -n "$IM_PORT" ]; then
      IMMICH_URL="http://host.docker.internal:$IM_PORT"
      ok "Immich gefunden: Container „$IM_NAME“, Port $IM_PORT"
    fi
  fi
fi
if [ -z "$IMMICH_URL" ]; then
  warn "Immich wurde nicht automatisch gefunden."
  IMMICH_URL="$(ask 'Immich-Adresse (leer lassen = später in der App)' '')"
fi
if [ -n "$IMMICH_URL" ]; then
  env_set IMMICH_URL "$IMMICH_URL"
  echo
  echo "Für die Fotos braucht FamilyHub einen API-Schlüssel aus Immich:"
  echo "  Immich im Browser öffnen → oben rechts Profilbild → Kontoeinstellungen → API-Schlüssel → Neuer API-Schlüssel"
  echo "  Rechte: asset.read, asset.view, album.read (oder „Alle“)"
  read -r -s -p "API-Schlüssel einfügen (Eingabe unsichtbar, leer = später in der App): " KEY || true; echo
  if [ -n "${KEY:-}" ]; then env_set IMMICH_API_KEY "$KEY"; ok "Schlüssel gespeichert (nur in ./.env, nur für root lesbar)"; fi
  [[ "$IMMICH_URL" == https://* ]] && env_set IMMICH_INSECURE "1"
fi

# ---------- 4. Starten ----------
mkdir -p data
# Der Container läuft als Benutzer "node" (UID 1000) – Datenordner muss ihm gehören
$SUDO chown -R 1000:1000 data 2>/dev/null || chown -R 1000:1000 data 2>/dev/null || warn "Konnte ./data nicht an UID 1000 übergeben"
say "FamilyHub wird gebaut und gestartet (beim ersten Mal 1–3 Minuten) …"
compose up -d --build
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then break; fi
  sleep 2
done
HEALTH="$(curl -fsS "http://127.0.0.1:$PORT/healthz" 2>/dev/null || true)"
[ -n "$HEALTH" ] || die "FamilyHub startet nicht. Protokoll: docker compose logs familyhub"
ok "FamilyHub läuft: $HEALTH"
if echo "$HEALTH" | grep -q '"immich":true'; then ok "Immich ist verbunden – Fotos und Diashow sind bereit";
elif [ -n "$IMMICH_URL" ]; then warn "Immich noch nicht verbunden – Schlüssel in der App eintragen (Mehr → Fotos)"; fi

# ---------- 5. Unterwegs (Tailscale) ----------
TS="$(ts_name || true)"
if [ -n "$TS" ]; then
  echo
  if [ "$(ask "HTTPS für unterwegs über Tailscale einrichten (https://$TS:$PORT)? (j/n)" j)" = "j" ]; then
    if $SUDO tailscale serve --bg --https="$PORT" "http://127.0.0.1:$PORT" >/dev/null 2>&1; then ok "Unterwegs erreichbar: https://$TS:$PORT/"
    else warn "tailscale serve nicht möglich (HTTPS-Zertifikate in der Tailscale-Verwaltung aktivieren). Alternativ: http://$TS:$PORT/"; fi
  fi
fi

IP="$(lan_ip)"
echo
say "Fertig! So geht es weiter:"
echo "  1. FamilyHub-App öffnen → Mehr → Synchronisierung"
echo "  2. Adresse eintragen:   http://${IP:-<Pi-IP>}:$PORT/"
echo "  3. Beim ersten Mal ein Familien-Passwort festlegen – alle weiteren Handys melden sich damit an."
[ -n "$TS" ] && echo "     Unterwegs (Tailscale an):  https://$TS:$PORT/  bzw.  http://$TS:$PORT/"
echo
echo "  Daten & Sicherungen: $(pwd)/data   ·   Update: ./install-pi.sh update   ·   Status: ./install-pi.sh status"
