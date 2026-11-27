//! Findet Ableton-Installation und User Library – auch außerhalb von Laufwerk C:.
//!
//! Reihenfolge für die User Library:
//! 1. Umgebungsvariable `LOM_ABLETON_USER_LIBRARY` (Tests/Fehlersuche)
//! 2. vom Benutzer in Connect Studio gewählter Ordner
//! 3. Lives eigene Einstellung (`…\Ableton\Live 12.x\Preferences\Library.cfg`, neueste zuerst)
//! 4. Windows-Standardorte (Dokumente, Musik)
//! 5. übliche Orte auf allen Laufwerken (z. B. `G:\Ableton\User Library`)

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub path: String,
    /// "env" | "settings" | "live" | "default" | "drive"
    pub source: String,
    pub exists: bool,
    /// enthält bereits `Remote Scripts/AbletonOSC/manager.py`
    pub has_abletonosc: bool,
}

fn attr_values<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let needle = format!("<{tag} Value=\"");
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find(&needle) {
        let after = &rest[i + needle.len()..];
        if let Some(end) = after.find('"') {
            out.push(&after[..end]);
            rest = &after[end..];
        } else {
            break;
        }
    }
    out
}

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&").replace("&quot;", "\"").replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">")
}

/// Liest mögliche User-Library-Pfade aus Lives `Library.cfg`.
/// Das Format ist nicht offiziell dokumentiert; ausgewertet werden `ProjectPath`/`ProjectName`
/// im Block `<UserLibrary>` und – als Rückfall – jeder Wert, der auf „User Library“ endet.
pub fn parse_library_cfg(xml: &str) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut push = |p: PathBuf| {
        if !p.as_os_str().is_empty() && !out.contains(&p) {
            out.push(p);
        }
    };
    let block = match (xml.find("<UserLibrary>"), xml.find("</UserLibrary>")) {
        (Some(a), Some(b)) if b > a => &xml[a..b],
        _ => "",
    };
    if !block.is_empty() {
        let paths = attr_values(block, "ProjectPath");
        let names = attr_values(block, "ProjectName");
        if let Some(p) = paths.first() {
            let base = PathBuf::from(unescape(p).trim_end_matches(['\\', '/']));
            if let Some(n) = names.first().filter(|n| !n.is_empty()) {
                push(base.join(unescape(n)));
            } else {
                // ohne Namensangabe: Ordner selbst oder Unterordner "User Library"
                push(base.join("User Library"));
                push(base);
            }
        }
    }
    // Rückfall: beliebige Werte, die wie ein User-Library-Pfad aussehen
    for v in xml.split("Value=\"").skip(1).filter_map(|s| s.split('"').next()) {
        let v = unescape(v);
        let t = v.trim_end_matches(['\\', '/']);
        if t.to_lowercase().ends_with("user library") {
            push(PathBuf::from(t));
        }
    }
    out
}

/// Alle `Library.cfg` aus Lives Einstellungsordnern, neueste zuerst.
pub fn library_cfg_files() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        roots.push(PathBuf::from(appdata).join("Ableton"));
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Library").join("Preferences").join("Ableton")); // macOS
    }
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for r in roots {
        let Ok(rd) = std::fs::read_dir(&r) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.starts_with("Live ") {
                continue;
            }
            for f in [e.path().join("Preferences").join("Library.cfg"), e.path().join("Library.cfg")] {
                if let Ok(md) = std::fs::metadata(&f) {
                    files.push((md.modified().unwrap_or(std::time::UNIX_EPOCH), f));
                }
            }
        }
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files.into_iter().map(|(_, f)| f).collect()
}

/// Wurzeln aller vorhandenen Laufwerke (nur Windows).
pub fn drive_roots() -> Vec<PathBuf> {
    if !cfg!(windows) {
        return Vec::new();
    }
    (b'A'..=b'Z')
        .map(|c| PathBuf::from(format!("{}:\\", c as char)))
        .filter(|p| p.exists())
        .collect()
}

fn user_name() -> Option<String> {
    std::env::var("USERNAME").or_else(|_| std::env::var("USER")).ok()
}

pub fn drive_user_library_guesses(roots: &[PathBuf]) -> Vec<PathBuf> {
    let user = user_name();
    let mut v = Vec::new();
    for r in roots {
        v.push(r.join("Ableton").join("User Library"));
        v.push(r.join("Documents").join("Ableton").join("User Library"));
        v.push(r.join("Dokumente").join("Ableton").join("User Library"));
        v.push(r.join("Music").join("Ableton").join("User Library"));
        v.push(r.join("Musik").join("Ableton").join("User Library"));
        v.push(r.join("Ableton User Library"));
        v.push(r.join("User Library"));
        if let Some(u) = &user {
            v.push(r.join("Users").join(u).join("Documents").join("Ableton").join("User Library"));
            v.push(r.join("Users").join(u).join("Music").join("Ableton").join("User Library"));
        }
    }
    v
}

fn cand(path: PathBuf, source: &str) -> Candidate {
    Candidate {
        exists: path.is_dir(),
        has_abletonosc: path.join("Remote Scripts").join("AbletonOSC").join("manager.py").is_file(),
        path: path.display().to_string(),
        source: source.into(),
    }
}

/// Alle Kandidaten in Prioritätsreihenfolge (ohne Duplikate).
pub fn user_library_candidates(user_choice: Option<&Path>) -> Vec<Candidate> {
    let mut list: Vec<(PathBuf, &str)> = Vec::new();
    if let Ok(e) = std::env::var("LOM_ABLETON_USER_LIBRARY") {
        list.push((PathBuf::from(e), "env"));
    }
    if let Some(c) = user_choice.filter(|c| !c.as_os_str().is_empty()) {
        list.push((c.to_path_buf(), "settings"));
    }
    for f in library_cfg_files() {
        if let Ok(xml) = std::fs::read_to_string(&f) {
            for p in parse_library_cfg(&xml) {
                list.push((p, "live"));
            }
        }
    }
    if let Some(d) = dirs::document_dir() {
        list.push((d.join("Ableton").join("User Library"), "default"));
    }
    if let Some(h) = dirs::home_dir() {
        list.push((h.join("Music").join("Ableton").join("User Library"), "default"));
    }
    for p in drive_user_library_guesses(&drive_roots()) {
        list.push((p, "drive"));
    }
    let mut seen = std::collections::HashSet::new();
    list.into_iter()
        .filter(|(p, _)| seen.insert(p.to_string_lossy().to_lowercase()))
        .map(|(p, s)| cand(p, s))
        // Laufwerks-Vermutungen nur zeigen, wenn es sie wirklich gibt
        .filter(|c| c.source != "drive" || c.exists)
        .collect()
}

/// Die zu verwendende User Library:
/// explizite Wahl (env/Einstellung) gewinnt immer; sonst der erste Kandidat mit AbletonOSC,
/// dann der erste vorhandene, sonst der erste überhaupt.
pub fn resolve_user_library(cands: &[Candidate]) -> Option<Candidate> {
    if let Some(c) = cands.iter().find(|c| c.source == "env" || c.source == "settings") {
        return Some(c.clone());
    }
    cands
        .iter()
        .find(|c| c.has_abletonosc)
        .or_else(|| cands.iter().find(|c| c.exists && c.source == "live"))
        .or_else(|| cands.iter().find(|c| c.exists))
        .or_else(|| cands.first())
        .cloned()
}

/// Ableton-Programmdateien: Standardpfade auf allen Laufwerken + laufender Prozess.
pub fn find_ableton_installations() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    for var in ["ProgramData", "ProgramFiles", "ProgramW6432"] {
        if let Ok(v) = std::env::var(var) {
            roots.push(Path::new(&v).join("Ableton"));
        }
    }
    for d in drive_roots() {
        roots.push(d.join("ProgramData").join("Ableton"));
        roots.push(d.join("Program Files").join("Ableton"));
        roots.push(d.join("Ableton"));
        roots.push(d.join("Programme").join("Ableton"));
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
    found.extend(running_ableton_exes());
    let mut seen = std::collections::HashSet::new();
    found.retain(|p| seen.insert(p.to_string_lossy().to_lowercase()));
    found
}

/// Programmpfade laufender Ableton-Live-Prozesse.
pub fn running_ableton_exes() -> Vec<PathBuf> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
    sys.processes()
        .values()
        .filter(|p| p.name().to_string_lossy().starts_with("Ableton Live"))
        .filter_map(|p| p.exe().map(|e| e.to_path_buf()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const CFG: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049" Creator="Ableton Live 12.1">
	<ContentLibrary>
		<UserLibrary>
			<LibraryProject>
				<ProjectHash Value="" />
				<ProjectName Value="User Library" />
				<ProjectPath Value="G:\Musik &amp; Produktion\Ableton\" />
			</LibraryProject>
		</UserLibrary>
		<FactoryPacks><ProjectPath Value="C:\ProgramData\Ableton\Live 12 Suite\Resources\" /></FactoryPacks>
	</ContentLibrary>
</Ableton>"#;

    #[test]
    fn library_cfg_user_library_on_other_drive() {
        let p = parse_library_cfg(CFG);
        let s: Vec<String> = p.iter().map(|x| x.display().to_string().replace('/', "\\")).collect();
        assert_eq!(s[0], "G:\\Musik & Produktion\\Ableton\\User Library");
        assert!(!s.iter().any(|x| x.contains("Resources")), "Factory-Packs dürfen nicht als User Library gelten");
        assert!(!s.iter().any(|x| x.ends_with("Produktion\\Ableton")), "übergeordneter Ordner ist keine User Library");
    }

    #[test]
    fn library_cfg_fallback_and_garbage() {
        let p = parse_library_cfg(r#"<X><Something Value="D:\Audio\User Library\" /></X>"#);
        assert_eq!(p[0].display().to_string().replace('/', "\\"), "D:\\Audio\\User Library");
        assert!(parse_library_cfg("kein xml").is_empty());
        assert!(parse_library_cfg("<UserLibrary><ProjectPath Value=\"").is_empty());
    }

    #[test]
    fn resolution_prefers_choice_then_abletonosc_then_live_setting() {
        let t = tempfile::tempdir().unwrap();
        let with_osc = t.path().join("A");
        std::fs::create_dir_all(with_osc.join("Remote Scripts/AbletonOSC")).unwrap();
        std::fs::write(with_osc.join("Remote Scripts/AbletonOSC/manager.py"), "x").unwrap();
        let live = t.path().join("B");
        std::fs::create_dir_all(&live).unwrap();
        let mk = |p: &Path, s: &str| cand(p.to_path_buf(), s);
        let missing = t.path().join("fehlt");

        let c = vec![mk(&missing, "default"), mk(&live, "live"), mk(&with_osc, "drive")];
        assert_eq!(resolve_user_library(&c).unwrap().path, with_osc.display().to_string());
        let c = vec![mk(&missing, "default"), mk(&live, "live")];
        assert_eq!(resolve_user_library(&c).unwrap().path, live.display().to_string());
        let c = vec![mk(&live, "live"), mk(&missing, "settings")];
        assert_eq!(resolve_user_library(&c).unwrap().source, "settings", "explizite Wahl gewinnt, auch wenn noch leer");
    }

    #[test]
    fn drive_guesses_cover_common_layouts() {
        let g = drive_user_library_guesses(&[PathBuf::from("G:\\")]);
        let s: Vec<String> = g.iter().map(|p| p.display().to_string()).collect();
        assert!(s.iter().any(|x| x.ends_with("Ableton\\User Library") || x.ends_with("Ableton/User Library")));
        assert!(s.len() >= 7);
    }
}
