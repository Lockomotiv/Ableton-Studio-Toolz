//! Diagnoseprüfungen. Jede Prüfung meldet nur, was sie tatsächlich
//! festgestellt hat; nicht durchführbare Prüfungen werden als `Skipped`
//! gekennzeichnet – niemals als bestanden.

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Serialize;

use crate::DawAdapter;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckStatus {
    Pass,
    Warn,
    Fail,
    Skipped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub id: String,
    pub label: String,
    pub status: CheckStatus,
    pub detail: String,
    pub duration_ms: f64,
}

fn check(id: &str, label: &str, start: Instant, status: CheckStatus, detail: impl Into<String>) -> DiagnosticCheck {
    DiagnosticCheck {
        id: id.into(),
        label: label.into(),
        status,
        detail: detail.into(),
        duration_ms: start.elapsed().as_secs_f64() * 1000.0,
    }
}

// ---------------------------------------------------------------- Ableton-Installation

/// Sucht Ableton-Live-Programmdateien unter den Standard-Installationspfaden von Windows.
pub fn find_ableton_installations() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    for var in ["ProgramData", "ProgramFiles", "ProgramW6432"] {
        if let Ok(v) = std::env::var(var) {
            roots.push(Path::new(&v).join("Ableton"));
        }
    }
    let mut found = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        for e in entries.flatten() {
            let program = e.path().join("Program");
            let Ok(files) = std::fs::read_dir(&program) else { continue };
            for f in files.flatten() {
                let name = f.file_name().to_string_lossy().to_string();
                if name.starts_with("Ableton Live") && name.to_lowercase().ends_with(".exe") {
                    found.push(f.path());
                }
            }
        }
    }
    found.sort();
    found.dedup();
    found
}

pub fn running_ableton_processes() -> Vec<String> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let mut names: Vec<String> = sys
        .processes()
        .values()
        .map(|p| p.name().to_string_lossy().to_string())
        .filter(|n| n.starts_with("Ableton Live"))
        .collect();
    names.sort();
    names.dedup();
    names
}

/// Mögliche Orte des AbletonOSC-Remote-Scripts (User Library).
pub fn abletonosc_candidates() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(custom) = std::env::var("LOM_ABLETON_USER_LIBRARY") {
        v.push(PathBuf::from(custom).join("Remote Scripts").join("AbletonOSC"));
    }
    if let Some(docs) = dirs::document_dir() {
        v.push(docs.join("Ableton").join("User Library").join("Remote Scripts").join("AbletonOSC"));
    }
    if let Some(home) = dirs::home_dir() {
        v.push(home.join("Music").join("Ableton").join("User Library").join("Remote Scripts").join("AbletonOSC"));
    }
    v
}

pub fn find_abletonosc() -> Option<PathBuf> {
    abletonosc_candidates()
        .into_iter()
        .find(|p| p.join("manager.py").is_file() && p.join("abletonosc").join("osc_server.py").is_file())
}

// ---------------------------------------------------------------- Netzwerkexposition

/// Parst `netstat -ano -p UDP` (Windows) und liefert die lokalen Adressen,
/// die auf `port` gebunden sind, jeweils mit PID.
pub fn parse_netstat_udp(output: &str, port: u16) -> Vec<(String, String)> {
    let suffix = format!(":{port}");
    output
        .lines()
        .filter_map(|l| {
            let t: Vec<&str> = l.split_whitespace().collect();
            if t.len() >= 3 && t[0].eq_ignore_ascii_case("UDP") && t[1].ends_with(&suffix) {
                Some((t[1].to_string(), t.last().unwrap_or(&"").to_string()))
            } else {
                None
            }
        })
        .collect()
}

pub fn is_wildcard_bind(local: &str) -> bool {
    local.starts_with("0.0.0.0:") || local.starts_with("[::]:") || local.starts_with("*:")
}

#[cfg(windows)]
fn run_netstat() -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("netstat")
        .args(["-ano", "-p", "UDP"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
}

#[cfg(not(windows))]
fn run_netstat() -> Option<String> {
    None
}

// ---------------------------------------------------------------- Gesamtlauf

pub async fn run_all(adapter: &dyn DawAdapter, osc_send_port: u16, osc_listen_port: u16) -> Vec<DiagnosticCheck> {
    let mut out = Vec::new();
    let windows = cfg!(windows);

    // 1. Ableton installiert
    let t = Instant::now();
    if windows {
        let inst = find_ableton_installations();
        let live12: Vec<_> = inst.iter().filter(|p| p.to_string_lossy().contains("Live 12")).collect();
        out.push(if !live12.is_empty() {
            check("ableton_installed", "Ableton Live 12 installiert", t, CheckStatus::Pass,
                  live12.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join("\n"))
        } else if !inst.is_empty() {
            check("ableton_installed", "Ableton Live 12 installiert", t, CheckStatus::Warn,
                  format!("Nur andere Live-Versionen gefunden:\n{}", inst.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join("\n")))
        } else {
            check("ableton_installed", "Ableton Live 12 installiert", t, CheckStatus::Fail,
                  "Keine Ableton-Live-Programmdatei unter %ProgramData%\\Ableton oder %ProgramFiles%\\Ableton gefunden. Bei abweichendem Installationsort kann diese Prüfung fehlschlagen, obwohl Live installiert ist.")
        });
    } else {
        out.push(check("ableton_installed", "Ableton Live 12 installiert", t, CheckStatus::Skipped,
                       "Installationserkennung ist nur unter Windows implementiert."));
    }

    // 2. Ableton läuft
    let t = Instant::now();
    let procs = running_ableton_processes();
    out.push(if procs.is_empty() {
        check("ableton_running", "Ableton Live läuft", t, CheckStatus::Fail, "Kein Prozess \"Ableton Live …\" gefunden.")
    } else {
        check("ableton_running", "Ableton Live läuft", t, CheckStatus::Pass, procs.join(", "))
    });

    // 3. AbletonOSC Remote Script vorhanden
    let t = Instant::now();
    out.push(match find_abletonosc() {
        Some(p) => check("abletonosc_installed", "AbletonOSC Remote Script installiert", t, CheckStatus::Pass, p.display().to_string()),
        None => check("abletonosc_installed", "AbletonOSC Remote Script installiert", t, CheckStatus::Fail,
                      format!("Nicht gefunden. Gesucht in:\n{}", abletonosc_candidates().iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join("\n"))),
    });

    // 4. Lokaler Antwortport
    let t = Instant::now();
    let port_label = format!("Antwortport 127.0.0.1:{osc_listen_port}");
    let port_label = port_label.as_str();
    out.push(if adapter.holds_listen_port() == Some(osc_listen_port) {
        check("osc_listen_port", port_label, t, CheckStatus::Pass,
              format!("Port {osc_listen_port} ist von Connect Studio gebunden (nur Loopback)."))
    } else {
        match std::net::UdpSocket::bind(("127.0.0.1", osc_listen_port)) {
            Ok(_) => check("osc_listen_port", port_label, t, CheckStatus::Pass,
                           format!("Port {osc_listen_port} ist frei.")),
            Err(e) => check("osc_listen_port", port_label, t, CheckStatus::Fail,
                            format!("Port {osc_listen_port} ist belegt ({e}). Ein anderes OSC-Programm verwendet ihn – AbletonOSC antwortet fest an diesen Port.")),
        }
    });

    // 5. OSC-Roundtrip + Version
    let t = Instant::now();
    let probe = adapter.probe().await;
    match probe.adapter {
        crate::AdapterKind::Mock => {
            out.push(check("osc_roundtrip", "AbletonOSC-Verbindung (/live/test)", t, CheckStatus::Skipped,
                           "Mock-Modus aktiv – es wurde keine Verbindung zu Ableton geprüft."));
        }
        crate::AdapterKind::AbletonOsc => {
            out.push(if probe.reachable {
                check("osc_roundtrip", "AbletonOSC-Verbindung (/live/test)", t, CheckStatus::Pass,
                      format!("Antwort erhalten, gemessene Roundtrip-Zeit {:.1} ms.", probe.roundtrip_ms.unwrap_or_default()))
            } else {
                check("osc_roundtrip", "AbletonOSC-Verbindung (/live/test)", t, CheckStatus::Fail, probe.message.clone())
            });
            let t = Instant::now();
            out.push(match &probe.live_version {
                Some(v) if v.starts_with("12.") => check("live_version", "Live-Version", t, CheckStatus::Pass, format!("Ableton Live {v}")),
                Some(v) => check("live_version", "Live-Version", t, CheckStatus::Warn, format!("Ableton Live {v} – getestet wird gegen Live 12.")),
                None => check("live_version", "Live-Version", t, CheckStatus::Fail, "Version nicht abrufbar."),
            });
        }
    }

    // 6. API-Kompatibilität (nur lesende Adressen)
    let t = Instant::now();
    if probe.reachable {
        if let Some(report) = adapter.check_read_api().await {
            let failed: Vec<_> = report.iter().filter(|(_, r)| r.is_err()).map(|(a, _)| a.clone()).collect();
            let detail = report
                .iter()
                .map(|(a, r)| format!("{} {a}", if r.is_ok() { "✔" } else { "✘" }))
                .collect::<Vec<_>>()
                .join("\n");
            out.push(check("osc_api", "AbletonOSC-API-Kompatibilität", t,
                           if failed.is_empty() { CheckStatus::Pass } else { CheckStatus::Fail },
                           format!("{detail}\nSchreibende Adressen (start_playing, set/tempo …) werden hier nicht ausgelöst, um Ihr Projekt nicht zu verändern.")));
        }
    } else {
        out.push(check("osc_api", "AbletonOSC-API-Kompatibilität", t, CheckStatus::Skipped, "Keine AbletonOSC-Verbindung – nicht prüfbar."));
    }

    // 7. Netzwerkexposition des AbletonOSC-Ports
    let t = Instant::now();
    out.push(match run_netstat() {
        None => check("osc_exposure", "OSC-Port nur lokal erreichbar", t, CheckStatus::Skipped,
                      "Prüfung nur unter Windows implementiert (netstat)."),
        Some(ns) => {
            let binds = parse_netstat_udp(&ns, osc_send_port);
            if binds.is_empty() {
                check("osc_exposure", "OSC-Port nur lokal erreichbar", t, CheckStatus::Skipped,
                      format!("Kein Prozess lauscht auf UDP {osc_send_port} – AbletonOSC ist nicht aktiv."))
            } else if binds.iter().any(|(a, _)| is_wildcard_bind(a)) {
                check("osc_exposure", "OSC-Port nur lokal erreichbar", t, CheckStatus::Warn,
                      format!("AbletonOSC lauscht auf ALLEN Netzwerkschnittstellen ({}). Jeder im LAN könnte Live steuern. Bitte die Firewall-Regel aus docs/security/osc-firewall.md anlegen.",
                              binds.iter().map(|(a, p)| format!("{a} PID {p}")).collect::<Vec<_>>().join(", ")))
            } else {
                check("osc_exposure", "OSC-Port nur lokal erreichbar", t, CheckStatus::Pass,
                      binds.iter().map(|(a, p)| format!("{a} PID {p}")).collect::<Vec<_>>().join(", "))
            }
        }
    });

    // 8. Gemessene OSC-Laufzeiten
    let t = Instant::now();
    let m = adapter.metrics();
    out.push(if m.count == 0 {
        check("osc_metrics", "OSC-Befehlslaufzeit (gemessen)", t, CheckStatus::Skipped,
              "Noch keine Messwerte vorhanden.")
    } else {
        check("osc_metrics", "OSC-Befehlslaufzeit (gemessen)", t, CheckStatus::Pass,
              format!("{} Messungen: min {:.1} ms · Ø {:.1} ms · p95 {:.1} ms · max {:.1} ms · Timeouts {}",
                      m.count, m.min_ms.unwrap_or_default(), m.avg_ms.unwrap_or_default(),
                      m.p95_ms.unwrap_or_default(), m.max_ms.unwrap_or_default(), m.timeouts))
    });

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  UDP    0.0.0.0:11000          *:*                                    15724
  UDP    127.0.0.1:11001        *:*                                    9920
  UDP    [::]:500               *:*                                    4512
";

    #[test]
    fn netstat_parsing_detects_wildcard() {
        let b = parse_netstat_udp(SAMPLE, 11000);
        assert_eq!(b, vec![("0.0.0.0:11000".to_string(), "15724".to_string())]);
        assert!(is_wildcard_bind(&b[0].0));
        let l = parse_netstat_udp(SAMPLE, 11001);
        assert!(!is_wildcard_bind(&l[0].0));
        assert!(parse_netstat_udp(SAMPLE, 1).is_empty());
    }

    #[tokio::test]
    async fn mock_diagnostics_never_claim_connection() {
        let m = crate::MockAdapter::new();
        let checks = run_all(&m, 11000, 11001).await;
        let rt = checks.iter().find(|c| c.id == "osc_roundtrip").unwrap();
        assert_eq!(rt.status, CheckStatus::Skipped);
        let api = checks.iter().find(|c| c.id == "osc_api").unwrap();
        assert_eq!(api.status, CheckStatus::Skipped);
    }
}
