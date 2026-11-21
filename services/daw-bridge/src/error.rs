use serde::Serialize;

#[derive(Debug, thiserror::Error, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum DawError {
    #[error("Keine Antwort von AbletonOSC auf {0} (Timeout). Läuft Ableton Live mit aktivierter AbletonOSC-Control-Surface?")]
    Timeout(String),
    #[error("Ungültiges Argument: {0}")]
    InvalidArgument(String),
    #[error("UDP-Port 127.0.0.1:{port} konnte nicht geöffnet werden: {reason}")]
    BindFailed { port: u16, reason: String },
    #[error("Netzwerkfehler: {0}")]
    Io(String),
    #[error("Unerwartete Antwort von AbletonOSC: {0}")]
    Protocol(String),
    #[error("Adapter wurde beendet")]
    Closed,
}
