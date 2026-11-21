//! Empfangsseite des Sample-Austauschs.
//!
//! Die Daten selbst kommen über einen WebRTC-DataChannel (Frontend); dieses Modul
//! entscheidet, WAS wohin geschrieben wird:
//!
//! * nur erlaubte Formate (WAV, AIFF, MP3, FLAC, MIDI) – keine ausführbaren Dateien,
//! * Dateiname wird auf eine einzelne, bereinigte Komponente reduziert
//!   (kein Path Traversal, keine reservierten Windows-Namen),
//! * Schreiben ausschließlich in den Empfangsordner, lückenlos und größenbegrenzt,
//! * SHA-256 wird nach dem Empfang neu berechnet und mit der Angabe des Senders verglichen,
//! * niemals überschreiben – bei Namensgleichheit "name (2).wav",
//! * Teil-Downloads werden unter `.incoming/<sha256>.part` aufbewahrt → Wiederaufnahme,
//! * Übernahme ins Ableton-Projekt nur auf ausdrückliche Anforderung und nur in einen
//!   Ordner, der als Ableton-Projekt erkennbar ist (`Samples/Imported/Connect Studio`).
//!
//! Empfangene Dateien werden niemals geöffnet oder ausgeführt.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha256};

pub const ALLOWED_EXTENSIONS: &[&str] = &["wav", "aif", "aiff", "mp3", "flac", "mid", "midi"];
pub const DEFAULT_MAX_BYTES: u64 = 512 * 1024 * 1024;
pub const IMPORT_SUBDIR: [&str; 3] = ["Samples", "Imported", "Connect Studio"];

#[derive(Debug, thiserror::Error, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum TransferError {
    #[error("Dateityp nicht erlaubt: {0} (erlaubt: WAV, AIFF, MP3, FLAC, MIDI)")]
    ExtensionNotAllowed(String),
    #[error("Ungültiger Dateiname: {0}")]
    InvalidName(String),
    #[error("Datei zu groß: {size} Bytes (Grenze {max} Bytes)")]
    TooLarge { size: u64, max: u64 },
    #[error("Ungültige Angabe: {0}")]
    Invalid(String),
    #[error("Unbekannte Übertragung {0}")]
    UnknownTransfer(String),
    #[error("Datenblock an falscher Position: erwartet {expected}, erhalten {got}")]
    OutOfOrder { expected: u64, got: u64 },
    #[error("Prüfsumme stimmt nicht: erwartet {expected}, berechnet {actual}. Datei wurde verworfen.")]
    HashMismatch { expected: String, actual: String },
    #[error("Kein Ableton-Projektordner (keine .als-Datei gefunden): {0}")]
    NotAbletonProject(String),
    #[error("Datei nicht gefunden: {0}")]
    NotFound(String),
    #[error("Dateisystemfehler: {0}")]
    Io(String),
}

impl From<std::io::Error> for TransferError {
    fn from(e: std::io::Error) -> Self {
        TransferError::Io(e.to_string())
    }
}

type R<T> = Result<T, TransferError>;

const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
    "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Reduziert einen vom Gegenüber gelieferten Namen auf einen sicheren Dateinamen.
pub fn sanitize_file_name(raw: &str) -> R<String> {
    let last = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let mut s: String = last
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| if "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    s = s.trim().trim_end_matches(['.', ' ']).to_string();
    while s.starts_with('.') {
        s.remove(0);
    }
    if s.is_empty() {
        return Err(TransferError::InvalidName(raw.chars().take(80).collect()));
    }
    let (stem, ext) = match s.rsplit_once('.') {
        Some((a, b)) if !a.is_empty() => (a.to_string(), b.to_ascii_lowercase()),
        _ => return Err(TransferError::ExtensionNotAllowed(s)),
    };
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(TransferError::ExtensionNotAllowed(ext));
    }
    let base_upper = stem.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
    let stem = if RESERVED.contains(&base_upper.as_str()) { format!("_{stem}") } else { stem };
    let stem: String = stem.chars().take(120).collect();
    Ok(format!("{stem}.{ext}"))
}

/// Liefert einen noch nicht existierenden Pfad: "a.wav", "a (2).wav", "a (3).wav" …
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    (2..).map(|i| dir.join(format!("{stem} ({i}).{ext}"))).find(|p| !p.exists()).unwrap()
}

fn valid_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn valid_sha(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

pub fn sha256_file(path: &Path) -> R<String> {
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BeginResult {
    pub id: String,
    pub file_name: String,
    pub resume_offset: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FinishResult {
    pub id: String,
    pub file_name: String,
    pub path: String,
    pub size: u64,
    pub sha256: String,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedFile {
    pub file_name: String,
    pub size: u64,
    pub modified_ms: u64,
}

struct Incoming {
    file_name: String,
    size: u64,
    sha256: String,
    part: PathBuf,
    written: u64,
    file: File,
}

pub struct ReceiveStore {
    root: PathBuf,
    max_bytes: u64,
    active: Mutex<HashMap<String, Incoming>>,
}

impl ReceiveStore {
    pub fn new(root: impl Into<PathBuf>, max_bytes: u64) -> R<Self> {
        let root = root.into();
        fs::create_dir_all(root.join(".incoming"))?;
        Ok(Self { root, max_bytes, active: Mutex::new(HashMap::new()) })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn max_bytes(&self) -> u64 {
        self.max_bytes
    }

    /// Bereitet den Empfang vor. Existiert bereits ein Teil-Download derselben Datei
    /// (gleiche Prüfsumme), wird ab dessen Ende fortgesetzt.
    pub fn begin(&self, id: &str, name: &str, size: u64, sha256: &str) -> R<BeginResult> {
        if !valid_id(id) {
            return Err(TransferError::Invalid("Übertragungs-ID".into()));
        }
        if !valid_sha(sha256) {
            return Err(TransferError::Invalid("SHA-256 (64 Hex-Zeichen, klein)".into()));
        }
        let file_name = sanitize_file_name(name)?;
        if size == 0 {
            return Err(TransferError::Invalid("leere Datei".into()));
        }
        if size > self.max_bytes {
            return Err(TransferError::TooLarge { size, max: self.max_bytes });
        }
        let part = self.root.join(".incoming").join(format!("{sha256}.part"));
        let mut file = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(&part)?;
        let mut existing = file.metadata()?.len();
        if existing > size {
            file.set_len(0)?;
            existing = 0;
        }
        file.seek(SeekFrom::Start(existing))?;
        self.active.lock().unwrap().insert(
            id.to_string(),
            Incoming { file_name: file_name.clone(), size, sha256: sha256.into(), part, written: existing, file },
        );
        Ok(BeginResult { id: id.into(), file_name, resume_offset: existing })
    }

    /// Schreibt einen Block. Blöcke müssen lückenlos in Reihenfolge kommen.
    pub fn write(&self, id: &str, offset: u64, data: &[u8]) -> R<u64> {
        let mut active = self.active.lock().unwrap();
        let inc = active.get_mut(id).ok_or_else(|| TransferError::UnknownTransfer(id.into()))?;
        if offset != inc.written {
            return Err(TransferError::OutOfOrder { expected: inc.written, got: offset });
        }
        if inc.written + data.len() as u64 > inc.size {
            return Err(TransferError::TooLarge { size: inc.written + data.len() as u64, max: inc.size });
        }
        inc.file.write_all(data)?;
        inc.written += data.len() as u64;
        Ok(inc.written)
    }

    /// Prüft Größe und SHA-256 und legt die Datei unter einem freien Namen ab.
    pub fn finish(&self, id: &str) -> R<FinishResult> {
        let inc = self.active.lock().unwrap().remove(id).ok_or_else(|| TransferError::UnknownTransfer(id.into()))?;
        let Incoming { file_name, size, sha256, part, written, mut file } = inc;
        file.flush()?;
        drop(file);
        if written != size {
            return Err(TransferError::Invalid(format!("unvollständig: {written} von {size} Bytes")));
        }
        let actual = sha256_file(&part)?;
        if actual != sha256 {
            let _ = fs::remove_file(&part);
            return Err(TransferError::HashMismatch { expected: sha256, actual });
        }
        let dest = unique_path(&self.root, &file_name);
        fs::rename(&part, &dest)?;
        Ok(FinishResult {
            id: id.into(),
            file_name: dest.file_name().unwrap().to_string_lossy().into(),
            path: dest.display().to_string(),
            size,
            sha256: actual,
            verified: true,
        })
    }

    /// Bricht ab. `keep_partial` = Teil-Download für spätere Wiederaufnahme behalten.
    pub fn cancel(&self, id: &str, keep_partial: bool) {
        if let Some(inc) = self.active.lock().unwrap().remove(id) {
            drop(inc.file);
            if !keep_partial {
                let _ = fs::remove_file(&inc.part);
            }
        }
    }

    pub fn list(&self) -> R<Vec<ReceivedFile>> {
        let mut v = Vec::new();
        for e in fs::read_dir(&self.root)?.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let md = e.metadata()?;
            if !md.is_file() || sanitize_file_name(&name).ok().as_deref() != Some(name.as_str()) {
                continue;
            }
            let modified_ms = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            v.push(ReceivedFile { file_name: name, size: md.len(), modified_ms });
        }
        v.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
        Ok(v)
    }

    fn resolve(&self, file_name: &str) -> R<PathBuf> {
        let clean = sanitize_file_name(file_name)?;
        if clean != file_name {
            return Err(TransferError::InvalidName(file_name.into()));
        }
        let p = self.root.join(&clean);
        if !p.is_file() {
            return Err(TransferError::NotFound(clean));
        }
        Ok(p)
    }

    /// Liest eine empfangene Datei für die Vorschau (nur bis `max` Bytes).
    pub fn read_for_preview(&self, file_name: &str, max: u64) -> R<Vec<u8>> {
        let p = self.resolve(file_name)?;
        let len = fs::metadata(&p)?.len();
        if len > max {
            return Err(TransferError::TooLarge { size: len, max });
        }
        Ok(fs::read(p)?)
    }

    /// Kopiert eine empfangene Datei in `<projekt>/Samples/Imported/Connect Studio/`.
    pub fn import_into_project(&self, file_name: &str, project_dir: &Path) -> R<PathBuf> {
        let src = self.resolve(file_name)?;
        if !is_ableton_project(project_dir) {
            return Err(TransferError::NotAbletonProject(project_dir.display().to_string()));
        }
        let dir = IMPORT_SUBDIR.iter().fold(project_dir.to_path_buf(), |p, s| p.join(s));
        fs::create_dir_all(&dir)?;
        let dest = unique_path(&dir, file_name);
        // create_new: schlägt fehl statt zu überschreiben, falls zwischenzeitlich angelegt
        let mut out = OpenOptions::new().write(true).create_new(true).open(&dest)?;
        let mut inp = File::open(&src)?;
        std::io::copy(&mut inp, &mut out)?;
        Ok(dest)
    }
}

pub fn is_ableton_project(dir: &Path) -> bool {
    let Ok(rd) = fs::read_dir(dir) else { return false };
    rd.flatten().any(|e| {
        let n = e.file_name().to_string_lossy().to_ascii_lowercase();
        n.ends_with(".als") && e.path().is_file()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sha(data: &[u8]) -> String {
        Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn sanitize_blocks_traversal_and_bad_types() {
        assert_eq!(sanitize_file_name("../../Windows/System32/evil.wav").unwrap(), "evil.wav");
        assert_eq!(sanitize_file_name("..\\..\\kick.WAV").unwrap(), "kick.wav");
        assert_eq!(sanitize_file_name("C:\\Users\\x\\snare.aif").unwrap(), "snare.aif");
        assert_eq!(sanitize_file_name("a<b>c:d.mid").unwrap(), "a_b_c_d.mid");
        assert_eq!(sanitize_file_name("CON.wav").unwrap(), "_CON.wav");
        assert_eq!(sanitize_file_name(".hidden.flac").unwrap(), "hidden.flac");
        assert!(matches!(sanitize_file_name("tool.exe"), Err(TransferError::ExtensionNotAllowed(_))));
        assert!(matches!(sanitize_file_name("song.wav.exe"), Err(TransferError::ExtensionNotAllowed(_))));
        assert!(matches!(sanitize_file_name("noext"), Err(TransferError::ExtensionNotAllowed(_))));
        assert!(sanitize_file_name("..").is_err());
        assert!(sanitize_file_name("loop.wav. . ").is_ok());
    }

    #[test]
    fn full_transfer_verifies_hash_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let st = ReceiveStore::new(dir.path(), 1 << 20).unwrap();
        let data: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();
        for round in 0..2 {
            let id = format!("transfer-{round}");
            let b = st.begin(&id, "../kick.wav", data.len() as u64, &sha(&data)).unwrap();
            assert_eq!(b.resume_offset, 0);
            let mut off = 0u64;
            for chunk in data.chunks(16 * 1024) {
                off = st.write(&id, off, chunk).unwrap();
            }
            let f = st.finish(&id).unwrap();
            assert!(f.verified);
            assert_eq!(f.file_name, if round == 0 { "kick.wav" } else { "kick (2).wav" });
            assert_eq!(std::fs::read(&f.path).unwrap(), data);
            assert!(Path::new(&f.path).starts_with(dir.path()));
        }
        assert_eq!(st.list().unwrap().len(), 2);
    }

    #[test]
    fn hash_mismatch_discards_file() {
        let dir = tempfile::tempdir().unwrap();
        let st = ReceiveStore::new(dir.path(), 1 << 20).unwrap();
        let data = b"RIFF....WAVEfake";
        st.begin("bad-hash-1", "x.wav", data.len() as u64, &sha(b"other")).unwrap();
        st.write("bad-hash-1", 0, data).unwrap();
        assert!(matches!(st.finish("bad-hash-1"), Err(TransferError::HashMismatch { .. })));
        assert!(st.list().unwrap().is_empty());
        assert_eq!(std::fs::read_dir(dir.path().join(".incoming")).unwrap().count(), 0);
    }

    #[test]
    fn size_limit_gaps_and_overflow_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let st = ReceiveStore::new(dir.path(), 1000).unwrap();
        assert!(matches!(st.begin("too-big-1", "a.wav", 1001, &sha(b"")), Err(TransferError::TooLarge { .. })));
        st.begin("gap-test-1", "a.wav", 10, &sha(b"0123456789")).unwrap();
        assert!(matches!(st.write("gap-test-1", 5, b"x"), Err(TransferError::OutOfOrder { .. })));
        assert!(matches!(st.write("gap-test-1", 0, b"0123456789AB"), Err(TransferError::TooLarge { .. })));
        assert!(matches!(st.write("unknown-1", 0, b"x"), Err(TransferError::UnknownTransfer(_))));
    }

    #[test]
    fn interrupted_transfer_resumes() {
        let dir = tempfile::tempdir().unwrap();
        let st = ReceiveStore::new(dir.path(), 1 << 20).unwrap();
        let data: Vec<u8> = (0..50_000u32).map(|i| (i * 7 % 256) as u8).collect();
        let h = sha(&data);
        st.begin("resume-aa", "pad.flac", data.len() as u64, &h).unwrap();
        st.write("resume-aa", 0, &data[..20_000]).unwrap();
        st.cancel("resume-aa", true); // Verbindungsabbruch
        let b = st.begin("resume-bb", "pad.flac", data.len() as u64, &h).unwrap();
        assert_eq!(b.resume_offset, 20_000);
        st.write("resume-bb", 20_000, &data[20_000..]).unwrap();
        assert!(st.finish("resume-bb").unwrap().verified);
    }

    #[test]
    fn import_requires_ableton_project_and_does_not_overwrite() {
        let recv = tempfile::tempdir().unwrap();
        let proj = tempfile::tempdir().unwrap();
        let st = ReceiveStore::new(recv.path(), 1 << 20).unwrap();
        st.begin("import-01", "bass.mid", 4, &sha(b"MThd")).unwrap();
        st.write("import-01", 0, b"MThd").unwrap();
        st.finish("import-01").unwrap();
        assert!(matches!(st.import_into_project("bass.mid", proj.path()), Err(TransferError::NotAbletonProject(_))));
        std::fs::write(proj.path().join("Song.als"), b"x").unwrap();
        let a = st.import_into_project("bass.mid", proj.path()).unwrap();
        let b = st.import_into_project("bass.mid", proj.path()).unwrap();
        assert!(a.ends_with("Samples/Imported/Connect Studio/bass.mid"));
        assert!(b.ends_with("Samples/Imported/Connect Studio/bass (2).mid"));
        assert!(st.import_into_project("../bass.mid", proj.path()).is_err());
        assert!(st.read_for_preview("..\\bass.mid", 100).is_err());
        assert_eq!(st.read_for_preview("bass.mid", 100).unwrap(), b"MThd");
    }
}
