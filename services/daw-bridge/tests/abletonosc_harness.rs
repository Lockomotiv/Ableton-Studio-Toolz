//! Integrationstests: echter `AbletonOscAdapter` (UDP) gegen den echten
//! AbletonOSC-Code (gepinnter Commit) mit gestubbter Live-API.
//! Siehe tests/integration/abletonosc-harness/harness.py.
//!
//! Voraussetzung: `scripts/fetch-abletonosc.sh` (bzw. .ps1) wurde ausgeführt
//! und Python 3 ist installiert. Mit LOM_SKIP_ABLETONOSC_HARNESS=1 werden die
//! Tests übersprungen (und als übersprungen ausgegeben).

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lom_daw_bridge::diagnostics::{run_all, CheckStatus};
use lom_daw_bridge::*;

struct Harness {
    child: Child,
    lines: Arc<Mutex<Vec<String>>>,
    listen: u16,
    response: u16,
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn free_port() -> u16 {
    std::net::UdpSocket::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn python() -> String {
    std::env::var("PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() })
}

fn skip() -> bool {
    if std::env::var("LOM_SKIP_ABLETONOSC_HARNESS").as_deref() == Ok("1") {
        eprintln!("ÜBERSPRUNGEN: LOM_SKIP_ABLETONOSC_HARNESS=1");
        return true;
    }
    false
}

impl Harness {
    fn start_on(listen: u16, response: u16) -> Harness {
        let dir = repo_root().join("tests/integration/abletonosc-harness");
        let aosc = dir.join("vendor/AbletonOSC");
        assert!(
            aosc.join("manager.py").is_file(),
            "AbletonOSC fehlt unter {} – bitte scripts/fetch-abletonosc.sh ausführen",
            aosc.display()
        );
        let mut child = Command::new(python())
            .arg("-u")
            .arg(dir.join("harness.py"))
            .arg("--abletonosc")
            .arg(&aosc)
            .args(["--listen-port", &listen.to_string(), "--response-port", &response.to_string()])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("Python konnte nicht gestartet werden");
        let lines = Arc::new(Mutex::new(Vec::new()));
        let out = child.stdout.take().unwrap();
        let l2 = lines.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                l2.lock().unwrap().push(line);
            }
        });
        let h = Harness { child, lines, listen, response };
        assert!(h.wait_line(|l| l.starts_with("HARNESS READY"), Duration::from_secs(10)), "Harness nicht bereit");
        h
    }

    fn start() -> Harness {
        Self::start_on(free_port(), free_port())
    }

    fn wait_line(&self, f: impl Fn(&str) -> bool, within: Duration) -> bool {
        let end = Instant::now() + within;
        while Instant::now() < end {
            if self.lines.lock().unwrap().iter().any(|l| f(l)) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    fn has_event(&self, needle: &str) -> bool {
        self.wait_line(|l| l.starts_with("EVENT") && l.contains(needle), Duration::from_secs(2))
    }

    async fn adapter(&self) -> AbletonOscAdapter {
        AbletonOscAdapter::bind(OscConfig {
            send_port: self.listen,
            listen_port: self.response,
            timeout: Duration::from_millis(1500),
        })
        .await
        .unwrap()
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn connection_is_detected() {
    if skip() { return; }
    let h = Harness::start();
    let a = h.adapter().await;
    let p = a.probe().await;
    assert!(p.reachable, "{}", p.message);
    assert_eq!(p.live_version.as_deref(), Some("12.1"));
    assert!(p.roundtrip_ms.unwrap() > 0.0);
    assert_eq!(a.connection(), ConnectionState::Connected);
    assert!(h.wait_line(|l| l.contains("Received OSC OK"), Duration::from_secs(1)));
}

#[tokio::test(flavor = "multi_thread")]
async fn play_and_stop_are_executed_and_verified() {
    if skip() { return; }
    let h = Harness::start();
    let a = h.adapter().await;
    let o = a.execute(DawCommand::Play).await.unwrap();
    assert!(o.verified, "{o:?}");
    assert!(h.has_event(r#""prop": "is_playing", "value": true"#));
    assert!(a.status().await.unwrap().is_playing);

    let o = a.execute(DawCommand::Stop).await.unwrap();
    assert!(o.verified);
    assert!(h.has_event(r#""prop": "is_playing", "value": false"#));
    assert!(!a.status().await.unwrap().is_playing);
}

#[tokio::test(flavor = "multi_thread")]
async fn tempo_and_loop() {
    if skip() { return; }
    let h = Harness::start();
    let a = h.adapter().await;
    assert!(a.execute(DawCommand::SetTempo { bpm: 128.5 }).await.unwrap().verified);
    assert!(h.has_event(r#""prop": "tempo", "value": 128.5"#));
    assert_eq!(a.status().await.unwrap().tempo, 128.5);
    assert!(a.execute(DawCommand::SetLoop { enabled: true }).await.unwrap().verified);
    assert!(h.has_event(r#""prop": "loop", "value": true"#));
    assert!(a.status().await.unwrap().loop_enabled);
    assert!(a.execute(DawCommand::SetLoop { enabled: false }).await.unwrap().verified);
    assert!(matches!(a.execute(DawCommand::SetTempo { bpm: 5.0 }).await, Err(DawError::InvalidArgument(_))));
}

#[tokio::test(flavor = "multi_thread")]
async fn tracks_volume_and_panning() {
    if skip() { return; }
    let h = Harness::start();
    let a = h.adapter().await;
    let t = a.tracks().await.unwrap();
    assert_eq!(t.len(), 4);
    assert_eq!(t[2].name, "Harness Track 3");
    assert!((t[2].volume - 0.85).abs() < 1e-6);
    assert!(a.execute(DawCommand::SetTrackVolume { track: 2, value: 0.5 }).await.unwrap().verified);
    assert!(h.has_event(r#""track": 2, "param": "volume", "value": 0.5"#));
    assert!(a.execute(DawCommand::SetTrackPanning { track: 1, value: -0.25 }).await.unwrap().verified);
    assert!(h.has_event(r#""track": 1, "param": "panning", "value": -0.25"#));
    let t = a.tracks().await.unwrap();
    assert!((t[2].volume - 0.5).abs() < 1e-6);
    assert!((t[1].panning + 0.25).abs() < 1e-6);

    // Ungültige Spur wird abgelehnt, ohne dass die Verbindung als gestört gilt.
    let r = a.execute(DawCommand::SetTrackVolume { track: 9, value: 0.5 }).await;
    assert!(matches!(r, Err(DawError::InvalidArgument(_))), "{r:?}");
    assert_eq!(a.connection(), ConnectionState::Connected);
}

#[tokio::test(flavor = "multi_thread")]
async fn fire_clip() {
    if skip() { return; }
    let h = Harness::start();
    let a = h.adapter().await;
    // Harness: Slot hat Clip, wenn (track + slot) gerade ist.
    let o = a.execute(DawCommand::FireClip { track: 1, slot: 1 }).await.unwrap();
    assert!(o.verified);
    assert!(h.has_event(r#""kind": "clip_fire", "track": 1, "slot": 1"#));
    assert!(matches!(
        a.execute(DawCommand::FireClip { track: 0, slot: 1 }).await,
        Err(DawError::InvalidArgument(_))
    ));
    assert!(matches!(
        a.execute(DawCommand::FireClip { track: 0, slot: 99 }).await,
        Err(DawError::InvalidArgument(_))
    ));
    assert_eq!(a.connection(), ConnectionState::Connected);
}

#[tokio::test(flavor = "multi_thread")]
async fn every_read_address_exists_in_abletonosc() {
    if skip() { return; }
    let h = Harness::start();
    let a = h.adapter().await;
    let report = a.read_api_report().await;
    for (addr, r) in &report {
        assert!(r.is_ok(), "{addr}: {r:?}");
    }
    assert!(report.len() >= 12);
    // Alle Befehle einmal ausführen und sicherstellen, dass AbletonOSC keine
    // "Unknown OSC address"-Fehler gemeldet hat.
    for c in [
        DawCommand::Play,
        DawCommand::ContinuePlaying,
        DawCommand::Stop,
        DawCommand::SetTempo { bpm: 100.0 },
        DawCommand::SetLoop { enabled: true },
        DawCommand::SetTrackVolume { track: 0, value: 0.3 },
        DawCommand::SetTrackPanning { track: 0, value: 0.3 },
        DawCommand::FireClip { track: 0, slot: 0 },
        DawCommand::SetLinkEnabled { enabled: true },
        DawCommand::SetLinkEnabled { enabled: false },
    ] {
        assert!(a.execute(c.clone()).await.unwrap().verified, "{c:?}");
    }
    tokio::time::sleep(Duration::from_millis(250)).await;
    let errors: Vec<_> = a.recent_errors().into_iter().filter(|e| e.level == "error").collect();
    assert!(errors.is_empty(), "AbletonOSC meldete Fehler: {errors:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn connection_loss_and_recovery() {
    if skip() { return; }
    let (listen, response) = (free_port(), free_port());
    let h = Harness::start_on(listen, response);
    let a = h.adapter().await;
    assert!(a.status().await.is_ok());
    drop(h); // "Ableton beendet"
    let r = a.status().await;
    assert!(matches!(r, Err(DawError::Timeout(_))), "{r:?}");
    assert_eq!(a.connection(), ConnectionState::Unreachable);
    assert!(!a.probe().await.reachable);

    let _h2 = Harness::start_on(listen, response); // "Ableton neu gestartet"
    let s = a.status().await.expect("Verbindung muss ohne Neustart des Clients wiederkommen");
    assert_eq!(s.connection, ConnectionState::Connected);
}

#[tokio::test(flavor = "multi_thread")]
async fn diagnostics_against_harness() {
    if skip() { return; }
    let h = Harness::start();
    let a = h.adapter().await;
    let checks = run_all(&a, h.listen, h.response).await;
    let get = |id: &str| checks.iter().find(|c| c.id == id).unwrap().clone();
    assert_eq!(get("osc_roundtrip").status, CheckStatus::Pass);
    assert_eq!(get("live_version").status, CheckStatus::Pass);
    assert_eq!(get("osc_api").status, CheckStatus::Pass, "{}", get("osc_api").detail);
    assert_eq!(get("osc_listen_port").status, CheckStatus::Pass);
    assert_eq!(get("osc_metrics").status, CheckStatus::Pass);
}

/// Installiert das gebündelte AbletonOSC wie Connect Studio mit "nur lokal" (Bind 127.0.0.1)
/// und startet es mit seinen eigenen Standardwerten: Es muss auf 127.0.0.1:11000 lauschen,
/// NICHT auf 0.0.0.0, und weiterhin normal antworten.
#[tokio::test(flavor = "multi_thread")]
async fn local_only_patch_binds_loopback_and_works() {
    if skip() { return; }
    let bundle = repo_root().join("apps/desktop/src-tauri/resources/AbletonOSC");
    if !bundle.join("manager.py").is_file() {
        eprintln!("ÜBERSPRUNGEN: {} fehlt – node scripts/prepare-abletonosc.mjs", bundle.display());
        return;
    }
    let tmp = std::env::temp_dir().join(format!("lom-patch-{}", std::process::id()));
    let target = tmp.join("AbletonOSC");
    let _ = std::fs::remove_dir_all(&tmp);
    copy_dir(&bundle, &target);
    let server = target.join("abletonosc/osc_server.py");
    let code = std::fs::read_to_string(&server).unwrap();
    std::fs::write(&server, code.replacen("('0.0.0.0', OSC_LISTEN_PORT)", "('127.0.0.1', OSC_LISTEN_PORT)", 1)).unwrap();

    let response = free_port();
    let dir = repo_root().join("tests/integration/abletonosc-harness");
    let mut child = Command::new(python())
        .arg("-u")
        .arg(dir.join("harness.py"))
        .arg("--abletonosc")
        .arg(&target)
        .args(["--response-port", &response.to_string(), "--keep-bind"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let lines = Arc::new(Mutex::new(Vec::new()));
    let out = child.stdout.take().unwrap();
    let l2 = lines.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            l2.lock().unwrap().push(line);
        }
    });
    let h = Harness { child, lines, listen: 11000, response };
    assert!(h.wait_line(|l| l.starts_with("HARNESS READY"), Duration::from_secs(10)), "Harness nicht bereit (Port 11000 belegt?)");
    assert!(h.wait_line(|l| l.contains("HARNESS BIND 127.0.0.1:11000"), Duration::from_secs(1)), "{:?}", h.lines.lock().unwrap());
    // Gegenprobe: Port 11000 auf einer LAN-Adresse binden. Das gelingt nur, wenn AbletonOSC
    // NICHT auf 0.0.0.0 (alle Schnittstellen) lauscht.
    let lan_ip = std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| s.connect("192.0.2.1:9").map(|_| s))
        .and_then(|s| s.local_addr())
        .map(|a| a.ip())
        .ok()
        .filter(|ip| !ip.is_loopback() && !ip.is_unspecified());
    match lan_ip {
        Some(ip) => {
            let probe = std::net::UdpSocket::bind((ip, 11000));
            assert!(probe.is_ok(), "AbletonOSC belegt {ip}:11000 – lauscht also nicht nur lokal");
        }
        None => eprintln!("Hinweis: keine LAN-Adresse – Gegenprobe übersprungen"),
    }
    let a = h.adapter().await;
    let p = a.probe().await;
    assert!(p.reachable, "{}", p.message);
    assert!(a.execute(DawCommand::Play).await.unwrap().verified);
    drop(h);
    let _ = std::fs::remove_dir_all(&tmp);
}

fn copy_dir(src: &std::path::Path, dst: &std::path::Path) {
    std::fs::create_dir_all(dst).unwrap();
    for e in std::fs::read_dir(src).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            copy_dir(&p, &dst.join(e.file_name()));
        } else {
            std::fs::copy(&p, dst.join(e.file_name())).unwrap();
        }
    }
}
