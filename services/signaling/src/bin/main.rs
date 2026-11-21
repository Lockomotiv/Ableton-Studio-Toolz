//! lom-signaling – selbst betreibbarer Signalisierungsdienst.
//!
//!   lom-signaling [--bind 0.0.0.0:8787] [--stun stun:host:3478]... [--turn turn:host:3478]...
//!
//! TURN-Geheimnis (coturn static-auth-secret) NUR über die Umgebungsvariable
//! LOM_TURN_SECRET übergeben. TLS über einen Reverse-Proxy (siehe docs/deployment).

use std::time::Duration;

use lom_signaling::{start, Config, TurnConfig};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut bind = "0.0.0.0:8787".to_string();
    let mut stun = Vec::new();
    let mut turn = Vec::new();
    let mut i = 1;
    while i < args.len() {
        let v = args.get(i + 1).cloned().unwrap_or_default();
        match args[i].as_str() {
            "--bind" => bind = v,
            "--stun" => stun.push(v),
            "--turn" => turn.push(v),
            "-h" | "--help" => {
                println!("lom-signaling [--bind ADDR] [--stun URL]... [--turn URL]...  (TURN-Geheimnis: LOM_TURN_SECRET)");
                return;
            }
            other => {
                eprintln!("Unbekanntes Argument: {other}");
                std::process::exit(2);
            }
        }
        i += 2;
    }
    let turn = match (turn.is_empty(), std::env::var("LOM_TURN_SECRET")) {
        (false, Ok(secret)) if !secret.is_empty() => Some(TurnConfig { urls: turn, secret, ttl: Duration::from_secs(12 * 3600) }),
        (false, _) => {
            eprintln!("--turn angegeben, aber LOM_TURN_SECRET fehlt");
            std::process::exit(2);
        }
        _ => None,
    };
    let cfg = Config { stun_urls: stun, turn, max_rooms: 1000 };
    let (addr, _state, handle) = start(bind.parse().expect("ungültige --bind-Adresse"), cfg).await.expect("Bind fehlgeschlagen");
    println!("lom-signaling lauscht auf ws://{addr}");
    let _ = handle.await;
}
