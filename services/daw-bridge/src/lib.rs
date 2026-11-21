//! LOCK-O-MOTIV Connect Studio – DAW-Bridge
//!
//! Gekapselter Zugriff auf Ableton Live. Zwei Implementierungen:
//! * [`MockAdapter`]  – In-Memory-Simulation, klar als Mock gekennzeichnet.
//! * [`AbletonOscAdapter`] – echte Verbindung über AbletonOSC (UDP, ausschließlich 127.0.0.1).

pub mod ableton_osc;
pub mod command;
pub mod diagnostics;
pub mod error;
pub mod metrics;
pub mod mock;
pub mod types;

pub use ableton_osc::{AbletonOscAdapter, OscConfig};
pub use command::DawCommand;
pub use error::DawError;
pub use mock::MockAdapter;
pub use types::*;

use async_trait::async_trait;

#[async_trait]
pub trait DawAdapter: Send + Sync {
    fn kind(&self) -> AdapterKind;
    /// Verbindungstest (`/live/test` + Versionsabfrage beim echten Adapter).
    async fn probe(&self) -> ProbeResult;
    async fn status(&self) -> Result<LiveStatus, DawError>;
    async fn tracks(&self) -> Result<Vec<TrackInfo>, DawError>;
    /// Führt einen Befehl aus der Allowlist aus und verifiziert ihn, wo möglich.
    async fn execute(&self, cmd: DawCommand) -> Result<CommandOutcome, DawError>;
    /// Zuletzt von AbletonOSC gemeldete Fehler (`/live/error`).
    fn recent_errors(&self) -> Vec<OscErrorEvent>;
    fn metrics(&self) -> metrics::MetricsSummary;
    /// Liefert true, wenn der Adapter selbst den lokalen Antwortport belegt.
    fn holds_listen_port(&self) -> Option<u16> {
        None
    }
    /// Prüft die benötigten Lese-Adressen gegen die laufende AbletonOSC-Instanz.
    /// `None` = für diesen Adapter nicht anwendbar (Mock).
    async fn check_read_api(&self) -> Option<Vec<(String, Result<(), DawError>)>> {
        None
    }
}
