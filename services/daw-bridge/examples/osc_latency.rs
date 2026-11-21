//! Misst echte OSC-Roundtrip-Zeiten gegen eine laufende AbletonOSC-Instanz.
//!
//!   cargo run -p lom-daw-bridge --example osc_latency -- [--count 200] [--send-port 11000] [--listen-port 11001] [--json pfad]
//!
//! Mit Ableton Live + AbletonOSC: misst die reale Latenz auf diesem Rechner.
//! Mit tests/performance/osc-latency.(sh|ps1): misst gegen die Harness-Gegenstelle.
//! Hinweis: Connect Studio darf währenddessen nicht laufen (Port 11001 ist exklusiv).

use std::time::{Duration, Instant};

use lom_daw_bridge::*;

fn arg(name: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned())
}

#[tokio::main]
async fn main() {
    let count: usize = arg("--count").and_then(|v| v.parse().ok()).unwrap_or(200);
    let cfg = OscConfig {
        send_port: arg("--send-port").and_then(|v| v.parse().ok()).unwrap_or(11000),
        listen_port: arg("--listen-port").and_then(|v| v.parse().ok()).unwrap_or(11001),
        timeout: Duration::from_millis(1500),
    };
    let a = match AbletonOscAdapter::bind(cfg.clone()).await {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    let p = a.probe().await;
    if !p.reachable {
        eprintln!("AbletonOSC nicht erreichbar: {}", p.message);
        std::process::exit(1);
    }
    println!("Verbunden: {} – {count} Messungen …", p.message);

    let start = Instant::now();
    let mut ok = 0;
    for _ in 0..count {
        if a.status().await.is_ok() {
            ok += 1;
        }
    }
    let wall = start.elapsed();
    let m = a.metrics();
    // Aktuelles Tempo unverändert erneut setzen: misst Befehl + Verifikation,
    // ohne das geöffnete Live-Projekt zu verändern.
    let current = a.status().await.map(|s| s.tempo).unwrap_or(120.0);
    let cmd_start = Instant::now();
    let play = a.execute(DawCommand::SetTempo { bpm: current }).await;
    let cmd_ms = cmd_start.elapsed().as_secs_f64() * 1000.0;

    println!("Statusabfragen erfolgreich: {ok}/{count} in {:.2} s", wall.as_secs_f64());
    println!(
        "OSC-Roundtrip je Nachricht (n={}): min {:.2} ms · Ø {:.2} ms · p95 {:.2} ms · max {:.2} ms · Timeouts {}",
        m.count,
        m.min_ms.unwrap_or_default(),
        m.avg_ms.unwrap_or_default(),
        m.p95_ms.unwrap_or_default(),
        m.max_ms.unwrap_or_default(),
        m.timeouts
    );
    match play {
        Ok(o) => println!("Befehl setTempo({current}) inkl. Verifikation: {cmd_ms:.2} ms (verifiziert: {})", o.verified),
        Err(e) => println!("Befehl setTempo fehlgeschlagen: {e}"),
    }
    if let Some(path) = arg("--json") {
        let out = serde_json::json!({
            "measuredAt": now_ms(),
            "target": format!("127.0.0.1:{}", cfg.send_port),
            "liveVersion": p.live_version,
            "statusQueries": { "requested": count, "ok": ok, "wallSeconds": wall.as_secs_f64() },
            "oscRoundtrip": { "count": m.count, "minMs": m.min_ms, "avgMs": m.avg_ms, "p95Ms": m.p95_ms, "maxMs": m.max_ms, "timeouts": m.timeouts },
            "setTempoVerifiedMs": cmd_ms,
        });
        std::fs::write(&path, serde_json::to_string_pretty(&out).unwrap()).unwrap();
        println!("Ergebnis gespeichert: {path}");
    }
}
