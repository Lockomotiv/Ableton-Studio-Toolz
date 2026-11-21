//! Projekt-Hub: Notizen und Planer-Aufgaben je Track-Projekt, lokal in SQLite.
//!
//! Das Frontend besitzt das Schema der Einträge; dieses Modul erzwingt nur die
//! Abgleichsregeln (Last-Writer-Wins nach Lamport-Uhr `clock`, Gleichstand nach
//! `site`) und Größengrenzen. Damit können beide Teilnehmer offline Ideen erfassen;
//! bei der nächsten Sitzung werden die Stände konfliktfrei zusammengeführt.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_ITEM_BYTES: usize = 32 * 1024;
pub const MAX_BATCH: usize = 2000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubProject {
    pub id: String,
    pub name: String,
    pub created_ms: u64,
}

fn valid_id(s: &str) -> bool {
    (1..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS hub_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_ms INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS hub_items (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, clock INTEGER NOT NULL, site TEXT NOT NULL, json TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS hub_items_project ON hub_items(project_id);",
    )
}

pub fn list_projects(conn: &Connection) -> rusqlite::Result<Vec<HubProject>> {
    let mut st = conn.prepare("SELECT id, name, created_ms FROM hub_projects ORDER BY created_ms DESC")?;
    let rows = st.query_map([], |r| Ok(HubProject { id: r.get(0)?, name: r.get(1)?, created_ms: r.get::<_, i64>(2)? as u64 }))?;
    rows.collect()
}

pub fn upsert_project(conn: &Connection, p: &HubProject) -> Result<HubProject, String> {
    if !valid_id(&p.id) {
        return Err("Ungültige Projekt-ID".into());
    }
    let name: String = p.name.trim().chars().take(120).collect();
    if name.is_empty() {
        return Err("Projektname fehlt".into());
    }
    conn.execute(
        "INSERT INTO hub_projects(id, name, created_ms) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name",
        params![p.id, name, p.created_ms as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(HubProject { id: p.id.clone(), name, created_ms: p.created_ms })
}

pub fn list_items(conn: &Connection, project_id: &str) -> rusqlite::Result<Vec<Value>> {
    let mut st = conn.prepare("SELECT json FROM hub_items WHERE project_id = ?1")?;
    let rows = st.query_map(params![project_id], |r| r.get::<_, String>(0))?;
    Ok(rows.filter_map(|r| r.ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect())
}

/// Führt Einträge zusammen und liefert die tatsächlich übernommenen zurück.
pub fn merge_items(conn: &Connection, project_id: &str, items: &[Value]) -> Result<Vec<Value>, String> {
    if !valid_id(project_id) {
        return Err("Ungültige Projekt-ID".into());
    }
    if items.len() > MAX_BATCH {
        return Err(format!("Zu viele Einträge ({} > {MAX_BATCH})", items.len()));
    }
    let mut applied = Vec::new();
    for it in items {
        let id = it.get("id").and_then(Value::as_str).filter(|s| valid_id(s)).ok_or("Eintrag ohne gültige id")?;
        let pid = it.get("projectId").and_then(Value::as_str).ok_or("Eintrag ohne projectId")?;
        if pid != project_id {
            return Err("Eintrag gehört zu einem anderen Projekt".into());
        }
        let clock = it.get("clock").and_then(Value::as_u64).ok_or("Eintrag ohne clock")?;
        let site = it.get("site").and_then(Value::as_str).filter(|s| valid_id(s)).ok_or("Eintrag ohne site")?;
        let json = serde_json::to_string(it).map_err(|e| e.to_string())?;
        if json.len() > MAX_ITEM_BYTES {
            return Err(format!("Eintrag {id} ist zu groß"));
        }
        let existing: Option<(i64, String, String)> = conn
            .query_row("SELECT clock, site, project_id FROM hub_items WHERE id = ?1", params![id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()
            .map_err(|e| e.to_string())?;
        let wins = match &existing {
            None => true,
            Some((_, _, p)) if p != project_id => return Err("ID-Kollision über Projekte".into()),
            Some((c, s, _)) => (clock, site) > (*c as u64, s.as_str()),
        };
        if wins {
            conn.execute(
                "INSERT INTO hub_items(id, project_id, clock, site, json) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET clock = excluded.clock, site = excluded.site, json = excluded.json",
                params![id, project_id, clock as i64, site, json],
            )
            .map_err(|e| e.to_string())?;
            applied.push(it.clone());
        }
    }
    Ok(applied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrate(&c).unwrap();
        upsert_project(&c, &HubProject { id: "p1".into(), name: "Track A".into(), created_ms: 1 }).unwrap();
        c
    }

    fn item(id: &str, clock: u64, site: &str, title: &str) -> Value {
        json!({"id": id, "projectId": "p1", "clock": clock, "site": site, "kind": "note", "title": title})
    }

    #[test]
    fn last_writer_wins_with_site_tiebreak() {
        let c = db();
        assert_eq!(merge_items(&c, "p1", &[item("n1", 1, "aaa", "v1")]).unwrap().len(), 1);
        assert_eq!(merge_items(&c, "p1", &[item("n1", 3, "aaa", "v3")]).unwrap().len(), 1);
        // älterer Stand verliert
        assert!(merge_items(&c, "p1", &[item("n1", 2, "zzz", "alt")]).unwrap().is_empty());
        // Gleichstand: größere site gewinnt – auf beiden Seiten gleich entschieden
        assert_eq!(merge_items(&c, "p1", &[item("n1", 3, "bbb", "gleich")]).unwrap().len(), 1);
        assert!(merge_items(&c, "p1", &[item("n1", 3, "aaa", "v3")]).unwrap().is_empty());
        let all = list_items(&c, "p1").unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0]["title"], "gleich");
    }

    #[test]
    fn invalid_items_are_rejected() {
        let c = db();
        assert!(merge_items(&c, "p1", &[json!({"id": "x", "projectId": "p1", "site": "a"})]).is_err());
        assert!(merge_items(&c, "p1", &[json!({"id": "x", "projectId": "p2", "clock": 1, "site": "a"})]).is_err());
        assert!(merge_items(&c, "p1", &[json!({"id": "../x", "projectId": "p1", "clock": 1, "site": "a"})]).is_err());
        let big = "x".repeat(MAX_ITEM_BYTES);
        assert!(merge_items(&c, "p1", &[json!({"id": "x", "projectId": "p1", "clock": 1, "site": "a", "body": big})]).is_err());
    }

    #[test]
    fn projects_roundtrip() {
        let c = db();
        upsert_project(&c, &HubProject { id: "p1".into(), name: "Umbenannt".into(), created_ms: 1 }).unwrap();
        let p = list_projects(&c).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].name, "Umbenannt");
        assert!(upsert_project(&c, &HubProject { id: "p 2".into(), name: "x".into(), created_ms: 1 }).is_err());
    }
}
