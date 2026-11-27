//! Ein-Klick-Installation des mitgelieferten AbletonOSC-Remote-Scripts.
//!
//! * Quelle: im Installer gebündelte, geprüfte Version (scripts/prepare-abletonosc.mjs).
//! * Ziel: `<User Library>/Remote Scripts/AbletonOSC`.
//! * Eine vorhandene Installation wird NICHT gelöscht, sondern in einen Sicherungsordner
//!   außerhalb von "Remote Scripts" verschoben (sonst listet Live sie als Control Surface).
//! * Option "nur lokal": einzige Änderung ist die Standard-Bind-Adresse in
//!   `abletonosc/osc_server.py` (0.0.0.0 → 127.0.0.1). Damit ist Live nicht mehr aus dem LAN steuerbar.
//! * Wird nur auf ausdrücklichen Klick ausgeführt; es werden keine Treiber installiert.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

pub const WILDCARD_BIND: &str = "('0.0.0.0', OSC_LISTEN_PORT)";
pub const LOCAL_BIND: &str = "('127.0.0.1', OSC_LISTEN_PORT)";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub target: String,
    pub backup: Option<String>,
    pub local_only: bool,
    pub commit: String,
    pub files: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BundledInfo {
    pub available: bool,
    pub commit: Option<String>,
    pub target: Option<String>,
    pub installed: bool,
    pub installed_local_only: Option<bool>,
}

fn copy_dir(src: &Path, dst: &Path, n: &mut usize) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for e in fs::read_dir(src)? {
        let e = e?;
        let name = e.file_name();
        let s = name.to_string_lossy();
        if s == "__pycache__" || s.ends_with(".pyc") || s == ".git" {
            continue;
        }
        let p = e.path();
        if e.file_type()?.is_dir() {
            copy_dir(&p, &dst.join(&name), n)?;
        } else {
            fs::copy(&p, dst.join(&name))?;
            *n += 1;
        }
    }
    Ok(())
}

pub fn remote_scripts_dir() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("LOM_ABLETON_USER_LIBRARY") {
        return Some(PathBuf::from(custom).join("Remote Scripts"));
    }
    dirs::document_dir().map(|d| d.join("Ableton").join("User Library").join("Remote Scripts"))
}

pub fn info(src: &Path, remote_scripts: Option<&Path>) -> BundledInfo {
    let available = src.join("manager.py").is_file() && src.join("abletonosc").join("osc_server.py").is_file();
    let commit = fs::read_to_string(src.join("COMMIT")).ok().map(|s| s.trim().to_string());
    let target = remote_scripts.map(|r| r.join("AbletonOSC"));
    let server = target.as_ref().map(|t| t.join("abletonosc").join("osc_server.py"));
    let installed = target.as_ref().map(|t| t.join("manager.py").is_file()).unwrap_or(false);
    let installed_local_only = server
        .and_then(|s| fs::read_to_string(s).ok())
        .map(|c| c.contains(LOCAL_BIND) && !c.contains(WILDCARD_BIND));
    BundledInfo { available, commit, target: target.map(|t| t.display().to_string()), installed, installed_local_only }
}

pub fn install(src: &Path, remote_scripts: &Path, backup_root: &Path, local_only: bool, now_unix: u64) -> Result<InstallResult, String> {
    if !src.join("manager.py").is_file() || !src.join("abletonosc").join("osc_server.py").is_file() {
        return Err("Mitgeliefertes AbletonOSC nicht gefunden – Installation von Connect Studio unvollständig?".into());
    }
    let commit = fs::read_to_string(src.join("COMMIT")).map(|s| s.trim().to_string()).unwrap_or_else(|_| "unbekannt".into());
    let server_src = fs::read_to_string(src.join("abletonosc").join("osc_server.py")).map_err(|e| e.to_string())?;
    if local_only && server_src.matches(WILDCARD_BIND).count() != 1 {
        return Err("Unerwartete AbletonOSC-Version: Bind-Adresse nicht eindeutig gefunden – Installation abgebrochen".into());
    }

    fs::create_dir_all(remote_scripts).map_err(|e| format!("Remote-Scripts-Ordner nicht anlegbar: {e}"))?;
    let target = remote_scripts.join("AbletonOSC");
    let mut backup = None;
    if target.exists() {
        fs::create_dir_all(backup_root).map_err(|e| e.to_string())?;
        let b = backup_root.join(format!("AbletonOSC-{now_unix}"));
        if fs::rename(&target, &b).is_err() {
            // anderes Laufwerk: kopieren, dann entfernen
            let mut n = 0;
            copy_dir(&target, &b, &mut n).map_err(|e| format!("Sicherung fehlgeschlagen: {e}"))?;
            fs::remove_dir_all(&target).map_err(|e| format!("Alte Version nicht entfernbar (läuft Live?): {e}"))?;
        }
        backup = Some(b.display().to_string());
    }

    let mut files = 0;
    copy_dir(src, &target, &mut files).map_err(|e| format!("Kopieren fehlgeschlagen: {e}"))?;
    if local_only {
        let p = target.join("abletonosc").join("osc_server.py");
        fs::write(&p, server_src.replacen(WILDCARD_BIND, LOCAL_BIND, 1)).map_err(|e| e.to_string())?;
    }
    fs::write(
        target.join("CONNECT_STUDIO.txt"),
        format!(
            "Installiert von LOCK-O-MOTIV Connect Studio\nAbletonOSC-Commit: {commit}\nNur lokal erreichbar (127.0.0.1): {}\nÄnderung gegenüber dem Original: {}\n",
            if local_only { "ja" } else { "nein" },
            if local_only { "abletonosc/osc_server.py – Standard-Bind-Adresse 0.0.0.0 → 127.0.0.1" } else { "keine" }
        ),
    )
    .map_err(|e| e.to_string())?;
    Ok(InstallResult { target: target.display().to_string(), backup, local_only, commit, files })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_src(dir: &Path) {
        fs::create_dir_all(dir.join("abletonosc").join("__pycache__")).unwrap();
        fs::create_dir_all(dir.join("pythonosc")).unwrap();
        fs::write(dir.join("manager.py"), "x").unwrap();
        fs::write(dir.join("COMMIT"), "0ca68214\n").unwrap();
        fs::write(dir.join("abletonosc").join("osc_server.py"), format!("def __init__(self, local_addr = {WILDCARD_BIND}):\n")).unwrap();
        fs::write(dir.join("abletonosc").join("__pycache__").join("x.pyc"), "c").unwrap();
        fs::write(dir.join("pythonosc").join("osc_message.py"), "m").unwrap();
    }

    #[test]
    fn installs_local_only_and_backs_up_previous() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("bundle");
        fake_src(&src);
        let rs = t.path().join("User Library").join("Remote Scripts");
        let bk = t.path().join("Backups");
        // vorhandene (fremde) Installation
        fs::create_dir_all(rs.join("AbletonOSC")).unwrap();
        fs::write(rs.join("AbletonOSC").join("manager.py"), "alt").unwrap();

        let r = install(&src, &rs, &bk, true, 1700000000).unwrap();
        assert_eq!(r.commit, "0ca68214");
        assert_eq!(r.files, 4, "ohne __pycache__");
        let server = fs::read_to_string(rs.join("AbletonOSC/abletonosc/osc_server.py")).unwrap();
        assert!(server.contains(LOCAL_BIND) && !server.contains(WILDCARD_BIND));
        assert_eq!(fs::read_to_string(bk.join("AbletonOSC-1700000000/manager.py")).unwrap(), "alt");
        assert!(!rs.join("AbletonOSC/abletonosc/__pycache__").exists());
        assert!(fs::read_to_string(rs.join("AbletonOSC/CONNECT_STUDIO.txt")).unwrap().contains("127.0.0.1"));
        let i = info(&src, Some(&rs));
        assert!(i.available && i.installed);
        assert_eq!(i.installed_local_only, Some(true));
        // Quelle bleibt unverändert
        assert!(fs::read_to_string(src.join("abletonosc/osc_server.py")).unwrap().contains(WILDCARD_BIND));
    }

    #[test]
    fn original_install_keeps_code_unchanged() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("bundle");
        fake_src(&src);
        let rs = t.path().join("rs");
        let r = install(&src, &rs, &t.path().join("bk"), false, 1).unwrap();
        assert!(r.backup.is_none());
        assert_eq!(
            fs::read_to_string(rs.join("AbletonOSC/abletonosc/osc_server.py")).unwrap(),
            fs::read_to_string(src.join("abletonosc/osc_server.py")).unwrap()
        );
        assert_eq!(info(&src, Some(&rs)).installed_local_only, Some(false));
    }

    #[test]
    fn refuses_unknown_version_for_patch_and_missing_bundle() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("bundle");
        fake_src(&src);
        fs::write(src.join("abletonosc/osc_server.py"), "bind = something_else").unwrap();
        assert!(install(&src, &t.path().join("rs"), &t.path().join("bk"), true, 1).is_err());
        assert!(!t.path().join("rs").join("AbletonOSC").exists());
        assert!(install(&t.path().join("nichts"), &t.path().join("rs"), &t.path().join("bk"), false, 1).is_err());
    }

    #[test]
    fn real_bundle_matches_patch_pattern() {
        // Prüft die tatsächlich gebündelte Datei, falls vorhanden (nach prepare-abletonosc.mjs)
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/AbletonOSC/abletonosc/osc_server.py");
        if let Ok(c) = fs::read_to_string(&p) {
            assert_eq!(c.matches(WILDCARD_BIND).count(), 1, "Patch-Muster muss genau einmal vorkommen");
        } else {
            eprintln!("übersprungen: {} fehlt", p.display());
        }
    }
}
