#!/usr/bin/env bash
# Lädt AbletonOSC in exakt der Version, gegen die Connect Studio geprüft wurde.
# Ziel: tests/integration/abletonosc-harness/vendor/AbletonOSC (nicht eingecheckt).
set -euo pipefail
COMMIT="0ca68214bd62c9b5cb641ca34006cfd70ba94430"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/tests/integration/abletonosc-harness/vendor/AbletonOSC"
if [ -d "$DEST/.git" ] && [ "$(git -C "$DEST" rev-parse HEAD)" = "$COMMIT" ]; then
  echo "AbletonOSC $COMMIT bereits vorhanden: $DEST"; exit 0
fi
rm -rf "$DEST"; mkdir -p "$DEST"
git -C "$DEST" init -q
git -C "$DEST" remote add origin https://github.com/ideoforms/AbletonOSC.git
git -C "$DEST" fetch -q --depth 1 origin "$COMMIT"
git -C "$DEST" checkout -q FETCH_HEAD
echo "AbletonOSC $(git -C "$DEST" rev-parse HEAD) -> $DEST"
