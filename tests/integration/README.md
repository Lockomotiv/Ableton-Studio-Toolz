# Integrationstests

`services/daw-bridge/tests/abletonosc_harness.rs` testet den echten `AbletonOscAdapter` (UDP) gegen
`abletonosc-harness/harness.py`: Dort läuft der **unveränderte AbletonOSC-Code** (Commit `0ca6821`)
mit gestubbter Live-API. Damit werden alle verwendeten OSC-Adressen, Argumentformate und
Antwortformate gegen die tatsächlich verwendete AbletonOSC-Version geprüft.

**Ersetzt keinen Test mit echtem Ableton Live** (Timing, Quantisierung, Live-Eigenheiten).

```bash
./scripts/fetch-abletonosc.sh          # bzw. scripts\fetch-abletonosc.ps1
cargo test -p lom-daw-bridge --test abletonosc_harness
```
