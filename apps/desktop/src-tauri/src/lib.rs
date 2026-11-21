//! Tauri-Backend von LOCK-O-MOTIV Connect Studio (Sprint 1).

mod hub;
mod settings;

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use lom_daw_bridge::diagnostics::{self, CheckStatus, DiagnosticCheck};
use lom_daw_bridge::metrics::MetricsSummary;
use lom_daw_bridge::*;
use serde::Serialize;
use hub::HubProject;
use lom_transfer::{BeginResult, FinishResult, ReceiveStore, ReceivedFile};
use settings::{Settings, SettingsStore};
use tauri::Manager;
use tokio::sync::{Mutex as AsyncMutex, RwLock};

pub struct AppState {
    adapter: RwLock<Arc<dyn DawAdapter>>,
    adapter_error: Mutex<Option<String>>,
    /// Serialisiert Befehle: strikt in Eingangsreihenfolge, nie parallel.
    exec_lock: AsyncMutex<()>,
    settings: Mutex<Option<SettingsStore>>,
    settings_error: Mutex<Option<String>>,
    data_dir: PathBuf,
    osc: OscConfig,
    receive: Result<ReceiveStore, String>,
    hosting: AsyncMutex<Option<Hosting>>,
}

struct Hosting {
    port: u16,
    task: tokio::task::JoinHandle<()>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostingInfo {
    active: bool,
    port: u16,
    /// ws://<ip>:<port> für jede IPv4-Adresse im lokalen Netz
    urls: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferInfo {
    receive_dir: String,
    max_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CmdError {
    kind: String,
    message: String,
}

impl From<DawError> for CmdError {
    fn from(e: DawError) -> Self {
        let kind = serde_json::to_value(&e)
            .ok()
            .and_then(|v| v.get("kind").and_then(|k| k.as_str()).map(String::from))
            .unwrap_or_else(|| "unknown".into());
        CmdError { kind, message: e.to_string() }
    }
}

fn err(kind: &str, message: impl Into<String>) -> CmdError {
    CmdError { kind: kind.into(), message: message.into() }
}

type CmdResult<T> = Result<T, CmdError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    platform: String,
    data_dir: String,
    adapter: AdapterKind,
    adapter_error: Option<String>,
    osc_send_port: u16,
    osc_listen_port: u16,
}

impl AppState {
    async fn current(&self) -> Arc<dyn DawAdapter> {
        self.adapter.read().await.clone()
    }

    async fn info(&self) -> AppInfo {
        AppInfo {
            version: env!("CARGO_PKG_VERSION").into(),
            platform: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
            data_dir: self.data_dir.display().to_string(),
            adapter: self.current().await.kind(),
            adapter_error: self.adapter_error.lock().unwrap().clone(),
            osc_send_port: self.osc.send_port,
            osc_listen_port: self.osc.listen_port,
        }
    }

    /// Wechselt den Adapter. Bei Fehler bleibt der bisherige Adapter aktiv.
    async fn switch(&self, kind: AdapterKind) -> Result<(), DawError> {
        let mut guard = self.adapter.write().await;
        if guard.kind() == kind {
            return Ok(());
        }
        let next: Arc<dyn DawAdapter> = match kind {
            AdapterKind::Mock => Arc::new(MockAdapter::new()),
            AdapterKind::AbletonOsc => {
                // Ein zuvor freigegebener Socket kann einen Moment brauchen.
                let mut last = None;
                let mut adapter = None;
                for _ in 0..10 {
                    match AbletonOscAdapter::bind(self.osc.clone()).await {
                        Ok(a) => {
                            adapter = Some(a);
                            break;
                        }
                        Err(e) => {
                            last = Some(e);
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                    }
                }
                match adapter {
                    Some(a) => Arc::new(a),
                    None => return Err(last.unwrap()),
                }
            }
        };
        *guard = next;
        *self.adapter_error.lock().unwrap() = None;
        Ok(())
    }

    fn log_outcome(&self, line: &serde_json::Value) {
        let dir = self.data_dir.join("logs");
        if std::fs::create_dir_all(&dir).is_err() {
            return;
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("daw-commands.jsonl"))
        {
            let _ = writeln!(f, "{line}");
        }
    }
}

// ------------------------------------------------------------------ Kommandos

#[tauri::command]
async fn app_info(state: tauri::State<'_, AppState>) -> CmdResult<AppInfo> {
    Ok(state.info().await)
}

#[tauri::command]
async fn daw_status(state: tauri::State<'_, AppState>) -> CmdResult<LiveStatus> {
    Ok(state.current().await.status().await?)
}

#[tauri::command]
async fn daw_tracks(state: tauri::State<'_, AppState>) -> CmdResult<Vec<TrackInfo>> {
    Ok(state.current().await.tracks().await?)
}

#[tauri::command]
async fn daw_probe(state: tauri::State<'_, AppState>) -> CmdResult<ProbeResult> {
    Ok(state.current().await.probe().await)
}

#[tauri::command]
async fn daw_execute(state: tauri::State<'_, AppState>, command: DawCommand) -> CmdResult<CommandOutcome> {
    let _ordered = state.exec_lock.lock().await;
    let adapter = state.current().await;
    let res = adapter.execute(command.clone()).await;
    state.log_outcome(&match &res {
        Ok(o) => serde_json::json!({"atMs": now_ms(), "ok": true, "outcome": o}),
        Err(e) => serde_json::json!({"atMs": now_ms(), "ok": false, "command": command, "adapter": adapter.kind(), "error": e.to_string()}),
    });
    Ok(res?)
}

#[tauri::command]
async fn daw_errors(state: tauri::State<'_, AppState>) -> CmdResult<Vec<OscErrorEvent>> {
    Ok(state.current().await.recent_errors())
}

#[tauri::command]
async fn daw_metrics(state: tauri::State<'_, AppState>) -> CmdResult<MetricsSummary> {
    Ok(state.current().await.metrics())
}

#[tauri::command]
async fn set_adapter(state: tauri::State<'_, AppState>, kind: AdapterKind) -> CmdResult<AppInfo> {
    state.switch(kind).await?;
    Ok(state.info().await)
}

#[tauri::command]
async fn run_diagnostics(state: tauri::State<'_, AppState>) -> CmdResult<Vec<DiagnosticCheck>> {
    let adapter = state.current().await;
    let mut checks = diagnostics::run_all(adapter.as_ref(), state.osc.send_port, state.osc.listen_port).await;
    let db_err = state.settings_error.lock().unwrap().clone();
    checks.push(DiagnosticCheck {
        id: "settings_db".into(),
        label: "Lokale Konfiguration (SQLite)".into(),
        status: if db_err.is_none() { CheckStatus::Pass } else { CheckStatus::Fail },
        detail: db_err.unwrap_or_else(|| state.data_dir.join("settings.sqlite").display().to_string()),
        duration_ms: 0.0,
    });
    Ok(checks)
}

fn with_db<T>(state: &AppState, f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>) -> CmdResult<T> {
    let g = state.settings.lock().unwrap();
    let store = g.as_ref().ok_or_else(|| err("settings", "Konfigurationsdatenbank nicht verfügbar"))?;
    f(store.conn()).map_err(|e| err("hub", e))
}

// ------------------------------------------------------------------ Hub

#[tauri::command]
fn hub_projects(state: tauri::State<'_, AppState>) -> CmdResult<Vec<HubProject>> {
    with_db(&state, |c| hub::list_projects(c).map_err(|e| e.to_string()))
}

#[tauri::command]
fn hub_project_upsert(state: tauri::State<'_, AppState>, project: HubProject) -> CmdResult<HubProject> {
    with_db(&state, |c| hub::upsert_project(c, &project))
}

#[tauri::command]
fn hub_items(state: tauri::State<'_, AppState>, project_id: String) -> CmdResult<Vec<serde_json::Value>> {
    with_db(&state, |c| hub::list_items(c, &project_id).map_err(|e| e.to_string()))
}

#[tauri::command]
fn hub_merge(state: tauri::State<'_, AppState>, project_id: String, items: Vec<serde_json::Value>) -> CmdResult<Vec<serde_json::Value>> {
    with_db(&state, |c| hub::merge_items(c, &project_id, &items))
}

// ------------------------------------------------------------------ Sample-Empfang

fn receive(state: &AppState) -> CmdResult<&ReceiveStore> {
    state.receive.as_ref().map_err(|e| err("transfer", e.clone()))
}

fn terr(e: lom_transfer::TransferError) -> CmdError {
    let kind = serde_json::to_value(&e)
        .ok()
        .and_then(|v| v.get("kind").and_then(|k| k.as_str()).map(String::from))
        .unwrap_or_else(|| "transfer".into());
    CmdError { kind, message: e.to_string() }
}

#[tauri::command]
fn transfer_info(state: tauri::State<'_, AppState>) -> CmdResult<TransferInfo> {
    let r = receive(&state)?;
    Ok(TransferInfo { receive_dir: r.root().display().to_string(), max_bytes: r.max_bytes() })
}

#[tauri::command]
fn transfer_begin(state: tauri::State<'_, AppState>, id: String, name: String, size: u64, sha256: String) -> CmdResult<BeginResult> {
    receive(&state)?.begin(&id, &name, size, &sha256).map_err(terr)
}

/// Binärer Datenblock: Body = Rohbytes, Header `x-transfer-id`, `x-offset`.
#[tauri::command]
fn transfer_write(state: tauri::State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<u64> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err(err("transfer", "Binärdaten erwartet"));
    };
    let h = request.headers();
    let id = h.get("x-transfer-id").and_then(|v| v.to_str().ok()).ok_or_else(|| err("transfer", "x-transfer-id fehlt"))?;
    let offset: u64 = h
        .get("x-offset")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| err("transfer", "x-offset fehlt"))?;
    receive(&state)?.write(id, offset, data).map_err(terr)
}

#[tauri::command]
fn transfer_finish(state: tauri::State<'_, AppState>, id: String) -> CmdResult<FinishResult> {
    receive(&state)?.finish(&id).map_err(terr)
}

#[tauri::command]
fn transfer_cancel(state: tauri::State<'_, AppState>, id: String, keep_partial: bool) -> CmdResult<()> {
    receive(&state)?.cancel(&id, keep_partial);
    Ok(())
}

#[tauri::command]
fn transfer_list(state: tauri::State<'_, AppState>) -> CmdResult<Vec<ReceivedFile>> {
    receive(&state)?.list().map_err(terr)
}

#[tauri::command]
fn transfer_preview(state: tauri::State<'_, AppState>, file_name: String) -> CmdResult<tauri::ipc::Response> {
    let bytes = receive(&state)?.read_for_preview(&file_name, 64 * 1024 * 1024).map_err(terr)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn transfer_import(state: tauri::State<'_, AppState>, file_name: String, project_dir: String) -> CmdResult<String> {
    receive(&state)?
        .import_into_project(&file_name, std::path::Path::new(&project_dir))
        .map(|p| p.display().to_string())
        .map_err(terr)
}

// ------------------------------------------------------------------ LAN-Hosting

fn lan_urls(port: u16) -> Vec<String> {
    let mut v: Vec<String> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback())
        .filter_map(|i| match i.ip() {
            std::net::IpAddr::V4(ip) if !ip.is_link_local() => Some(format!("ws://{ip}:{port}")),
            _ => None,
        })
        .collect();
    v.sort();
    v.dedup();
    v
}

/// Startet den eingebetteten Signalisierungsdienst für LAN-Sitzungen.
/// Er lauscht auf allen Schnittstellen, nimmt aber nur Teilnehmer mit gültigem
/// Einladungsgeheimnis an und transportiert keine Medien/Steuerdaten.
#[tauri::command]
async fn hosting_start(state: tauri::State<'_, AppState>, port: u16) -> CmdResult<HostingInfo> {
    let mut h = state.hosting.lock().await;
    if let Some(cur) = h.as_ref() {
        if cur.port == port && !cur.task.is_finished() {
            return Ok(HostingInfo { active: true, port, urls: lan_urls(port) });
        }
    }
    if let Some(old) = h.take() {
        old.task.abort();
    }
    let bind = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let (addr, _st, task) = lom_signaling::start(bind, lom_signaling::Config::default())
        .await
        .map_err(|e| err("hosting", format!("Port {port} konnte nicht geöffnet werden: {e}")))?;
    *h = Some(Hosting { port: addr.port(), task });
    Ok(HostingInfo { active: true, port: addr.port(), urls: lan_urls(addr.port()) })
}

#[tauri::command]
async fn hosting_stop(state: tauri::State<'_, AppState>) -> CmdResult<HostingInfo> {
    if let Some(old) = state.hosting.lock().await.take() {
        old.task.abort();
    }
    Ok(HostingInfo { active: false, port: 0, urls: vec![] })
}

#[tauri::command]
fn settings_get(state: tauri::State<'_, AppState>) -> CmdResult<Settings> {
    let g = state.settings.lock().unwrap();
    let store = g.as_ref().ok_or_else(|| err("settings", "Konfigurationsdatenbank nicht verfügbar"))?;
    store.load().map_err(|e| err("settings", e.to_string()))
}

#[tauri::command]
fn settings_save(state: tauri::State<'_, AppState>, settings: Settings) -> CmdResult<Settings> {
    let g = state.settings.lock().unwrap();
    let store = g.as_ref().ok_or_else(|| err("settings", "Konfigurationsdatenbank nicht verfügbar"))?;
    store.save(&settings).map_err(|e| err("settings", e.to_string()))?;
    Ok(settings)
}

// ------------------------------------------------------------------ Start

fn env_port(name: &str, default: u16) -> u16 {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn env_adapter() -> Option<AdapterKind> {
    match std::env::var("LOM_ADAPTER").ok()?.as_str() {
        "mock" => Some(AdapterKind::Mock),
        "abletonOsc" | "ableton" | "osc" => Some(AdapterKind::AbletonOsc),
        _ => None,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = std::env::var("LOM_DATA_DIR")
                .map(PathBuf::from)
                .or_else(|_| app.path().app_data_dir())
                .expect("Datenverzeichnis nicht bestimmbar");
            std::fs::create_dir_all(&data_dir)?;

            let (store, settings_error) = match SettingsStore::open(&data_dir.join("settings.sqlite")) {
                Ok(s) => (Some(s), None),
                Err(e) => (None, Some(e.to_string())),
            };
            let saved = store.as_ref().and_then(|s| s.load().ok()).unwrap_or_default();

            let osc = OscConfig {
                send_port: env_port("LOM_OSC_SEND_PORT", ableton_osc::DEFAULT_SEND_PORT),
                listen_port: env_port("LOM_OSC_LISTEN_PORT", ableton_osc::DEFAULT_LISTEN_PORT),
                ..Default::default()
            };

            let receive_dir = if std::env::var("LOM_DATA_DIR").is_ok() {
                data_dir.join("received")
            } else {
                dirs::document_dir()
                    .map(|d| d.join("LOCK-O-MOTIV Connect Studio").join("Empfangen"))
                    .unwrap_or_else(|| data_dir.join("received"))
            };
            let receive = ReceiveStore::new(receive_dir, lom_transfer::DEFAULT_MAX_BYTES).map_err(|e| e.to_string());

            let state = AppState {
                adapter: RwLock::new(Arc::new(MockAdapter::new())),
                adapter_error: Mutex::new(None),
                exec_lock: AsyncMutex::new(()),
                settings: Mutex::new(store),
                settings_error: Mutex::new(settings_error),
                data_dir,
                osc,
                receive,
                hosting: AsyncMutex::new(None),
            };

            // Ohne Einrichtung startet der Client immer im Mock-Modus.
            let wanted = env_adapter().unwrap_or(saved.adapter);
            if wanted == AdapterKind::AbletonOsc {
                if let Err(e) = tauri::async_runtime::block_on(state.switch(AdapterKind::AbletonOsc)) {
                    *state.adapter_error.lock().unwrap() = Some(format!(
                        "AbletonOSC-Adapter konnte nicht gestartet werden: {e} – Mock-Modus ist aktiv."
                    ));
                }
            }
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            daw_status,
            daw_tracks,
            daw_probe,
            daw_execute,
            daw_errors,
            daw_metrics,
            set_adapter,
            run_diagnostics,
            settings_get,
            settings_save,
            hub_projects,
            hub_project_upsert,
            hub_items,
            hub_merge,
            transfer_info,
            transfer_begin,
            transfer_write,
            transfer_finish,
            transfer_cancel,
            transfer_list,
            transfer_preview,
            transfer_import,
            hosting_start,
            hosting_stop,
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Start von Connect Studio");
}
