#!/usr/bin/env bash
# Misst OSC-Laufzeiten gegen die AbletonOSC-Harness (echter AbletonOSC-Code, KEIN echtes Live).
# Für Messungen gegen echtes Ableton: Live + AbletonOSC starten und direkt
#   cargo run -p lom-daw-bridge --example osc_latency -- --count 200
# ausführen.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="${PYTHON:-python3}"
L=$(( 20000 + RANDOM % 20000 )); R=$(( L + 1 ))
"$PY" -u "$ROOT/tests/integration/abletonosc-harness/harness.py" \
  --abletonosc "$ROOT/tests/integration/abletonosc-harness/vendor/AbletonOSC" \
  --listen-port "$L" --response-port "$R" > /dev/null &
H=$!; trap 'kill $H 2>/dev/null' EXIT; sleep 1.5
OUT="$ROOT/tests/performance/results/osc-latency-harness-$(date +%Y%m%d-%H%M%S).json"
cargo run -q -p lom-daw-bridge --example osc_latency -- --count "${COUNT:-200}" --send-port "$L" --listen-port "$R" --json "$OUT"
