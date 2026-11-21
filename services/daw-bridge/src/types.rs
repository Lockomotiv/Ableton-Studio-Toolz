//! Gemeinsame Datentypen. Die JSON-Form (camelCase) wird 1:1 in
//! `packages/shared-types` gespiegelt.

use serde::{Deserialize, Serialize};

/// Welcher Adapter beantwortet Anfragen?
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdapterKind {
    /// In-Memory-Simulation. Liefert NIEMALS Daten aus Ableton.
    Mock,
    /// Echte Verbindung über AbletonOSC (UDP, nur 127.0.0.1).
    AbletonOsc,
}

/// Verbindungszustand – wird nur aus tatsächlichen Antworten abgeleitet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    /// Noch keine Anfrage beantwortet.
    Unknown,
    /// Letzte Anfrage wurde innerhalb des Timeouts beantwortet.
    Connected,
    /// Letzte Anfrage lief in einen Timeout / Socketfehler.
    Unreachable,
    /// Mock-Adapter aktiv (keine echte Verbindung).
    Simulated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    pub adapter: AdapterKind,
    pub connection: ConnectionState,
    /// z. B. "12.1" – nur gesetzt, wenn Live die Version gemeldet hat.
    pub live_version: Option<String>,
    pub is_playing: bool,
    pub tempo: f32,
    pub loop_enabled: bool,
    pub num_tracks: u32,
    /// Gemessene Dauer der gesamten Statusabfrage in ms (Mock: 0).
    pub query_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub index: u32,
    pub name: String,
    /// Live-Mixerwert 0.0 … 1.0 (0.85 ≈ 0 dB)
    pub volume: f32,
    /// -1.0 (links) … 1.0 (rechts)
    pub panning: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub adapter: AdapterKind,
    pub reachable: bool,
    pub live_version: Option<String>,
    /// Gemessene OSC-Roundtrip-Zeit von `/live/test` in ms.
    pub roundtrip_ms: Option<f64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutcome {
    pub command: crate::DawCommand,
    pub adapter: AdapterKind,
    /// true = Zustand wurde nach dem Befehl aus Live zurückgelesen und stimmt.
    pub verified: bool,
    /// Gesamtdauer Befehl + Rücklese-Verifikation (gemessen) in ms.
    pub total_ms: f64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OscErrorEvent {
    /// Unix-Zeit in ms
    pub at_ms: u64,
    /// "error" = `/live/error`, "info" = z. B. `/live/startup`
    pub level: String,
    pub message: String,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
