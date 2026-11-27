//! Lokale Konfiguration in SQLite (Schlüssel/Wert, JSON-Werte).
//! Enthält bewusst KEINE Geheimnisse – diese gehören ab Sprint 2 in den
//! Windows Credential Manager.

use std::path::Path;

use lom_daw_bridge::AdapterKind;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Host,
    Guest,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StudioMode {
    Remote,
    Dual,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub role: Option<Role>,
    pub default_mode: Option<StudioMode>,
    pub adapter: AdapterKind,
    pub setup_completed: bool,
    /// Anzeigename in Sitzungen
    pub display_name: String,
    /// Zufällige, dauerhafte Kennung dieses Rechners für den Hub-Abgleich (keine Geheimnisse)
    pub site_id: String,
    /// Signalisierungsserver für Internet-Sitzungen, z. B. wss://signal.example.org
    pub signaling_url: String,
    /// Öffentlichen STUN-Server (stun.l.google.com) verwenden
    pub use_public_stun: bool,
    /// Zusätzliche STUN-URLs, eine je Zeile (TURN-Zugangsdaten kommen vom eigenen Signalisierungsserver)
    pub extra_stun: String,
    /// Port für LAN-Sitzungen (eingebetteter Signalisierungsdienst)
    pub lan_port: u16,
    /// Ordner des aktuellen Ableton-Projekts (für "Ins Projekt übernehmen")
    pub project_folder: String,
    /// Zuletzt geöffnetes Hub-Projekt
    pub active_project_id: String,
    /// Vom Benutzer gewählte Ableton User Library (leer = automatisch erkennen)
    pub user_library_path: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            role: None,
            default_mode: None,
            adapter: AdapterKind::Mock,
            setup_completed: false,
            display_name: String::new(),
            site_id: String::new(),
            signaling_url: String::new(),
            use_public_stun: true,
            extra_stun: String::new(),
            lan_port: 47870,
            project_folder: String::new(),
            active_project_id: String::new(),
            user_library_path: String::new(),
        }
    }
}

pub struct SettingsStore {
    conn: Connection,
}

const KEY: &str = "settings.v1";

impl SettingsStore {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);",
        )?;
        crate::hub::migrate(&conn)?;
        Ok(Self { conn })
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn load(&self) -> rusqlite::Result<Settings> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT value FROM kv WHERE key = ?1", params![KEY], |r| r.get(0))
            .optional()?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
    }

    pub fn save(&self, s: &Settings) -> rusqlite::Result<()> {
        let json = serde_json::to_string(s).expect("Settings serialisierbar");
        self.conn.execute(
            "INSERT INTO kv(key, value, updated_at) VALUES (?1, ?2, strftime('%s','now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![KEY, json],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_then_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("s.sqlite");
        let st = SettingsStore::open(&p).unwrap();
        assert_eq!(st.load().unwrap(), Settings::default());
        let s = Settings {
            role: Some(Role::Host),
            default_mode: Some(StudioMode::Dual),
            adapter: AdapterKind::AbletonOsc,
            setup_completed: true,
            display_name: "Lock".into(),
            ..Default::default()
        };
        st.save(&s).unwrap();
        drop(st);
        assert_eq!(SettingsStore::open(&p).unwrap().load().unwrap(), s);
    }

    #[test]
    fn json_shape_matches_frontend() {
        let j = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(j["adapter"], "mock");
        assert_eq!(j["lanPort"], 47870);
        assert_eq!(j["usePublicStun"], true);
    }

    #[test]
    fn sprint1_settings_still_load() {
        let old = r#"{"role":"host","defaultMode":"remote","adapter":"abletonOsc","setupCompleted":true}"#;
        let s: Settings = serde_json::from_str(old).unwrap();
        assert!(s.setup_completed);
        assert_eq!(s.lan_port, 47870);
    }
}
