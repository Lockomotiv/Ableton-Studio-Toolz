//! Allowlist aller DAW-Befehle.
//!
//! Es gibt bewusst KEINEN generischen "sende beliebige OSC-Adresse"-Befehl.
//! Alles, was ein Client (lokal oder später remote) auslösen darf, steht in
//! diesem Enum; jede Variante wird vor der Ausführung validiert.

use serde::{Deserialize, Serialize};

use crate::DawError;

pub const TEMPO_MIN: f32 = 20.0;
pub const TEMPO_MAX: f32 = 999.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DawCommand {
    Play,
    Stop,
    ContinuePlaying,
    SetTempo { bpm: f32 },
    SetLoop { enabled: bool },
    SetTrackVolume { track: u32, value: f32 },
    SetTrackPanning { track: u32, value: f32 },
    FireClip { track: u32, slot: u32 },
}

impl DawCommand {
    /// Prüft Wertebereiche, die ohne DAW-Zustand prüfbar sind.
    /// Spurindizes werden zusätzlich im Adapter gegen die echte Spuranzahl geprüft.
    pub fn validate(&self) -> Result<(), DawError> {
        fn finite(v: f32, what: &str) -> Result<(), DawError> {
            if v.is_finite() {
                Ok(())
            } else {
                Err(DawError::InvalidArgument(format!("{what} ist keine endliche Zahl")))
            }
        }
        match *self {
            DawCommand::SetTempo { bpm } => {
                finite(bpm, "BPM")?;
                if !(TEMPO_MIN..=TEMPO_MAX).contains(&bpm) {
                    return Err(DawError::InvalidArgument(format!(
                        "BPM {bpm} außerhalb des Live-Bereichs {TEMPO_MIN}–{TEMPO_MAX}"
                    )));
                }
            }
            DawCommand::SetTrackVolume { value, .. } => {
                finite(value, "Lautstärke")?;
                if !(0.0..=1.0).contains(&value) {
                    return Err(DawError::InvalidArgument(format!(
                        "Lautstärke {value} außerhalb 0.0–1.0"
                    )));
                }
            }
            DawCommand::SetTrackPanning { value, .. } => {
                finite(value, "Panorama")?;
                if !(-1.0..=1.0).contains(&value) {
                    return Err(DawError::InvalidArgument(format!(
                        "Panorama {value} außerhalb -1.0–1.0"
                    )));
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub fn track_index(&self) -> Option<u32> {
        match *self {
            DawCommand::SetTrackVolume { track, .. }
            | DawCommand::SetTrackPanning { track, .. }
            | DawCommand::FireClip { track, .. } => Some(track),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_wire_format_is_stable() {
        let c = DawCommand::SetTrackVolume { track: 2, value: 0.5 };
        let j = serde_json::to_string(&c).unwrap();
        assert_eq!(j, r#"{"type":"setTrackVolume","track":2,"value":0.5}"#);
        let p: DawCommand = serde_json::from_str(r#"{"type":"play"}"#).unwrap();
        assert_eq!(p, DawCommand::Play);
        let f: DawCommand = serde_json::from_str(r#"{"type":"fireClip","track":1,"slot":3}"#).unwrap();
        assert_eq!(f, DawCommand::FireClip { track: 1, slot: 3 });
    }

    #[test]
    fn unknown_command_is_rejected_by_deserializer() {
        let r: Result<DawCommand, _> =
            serde_json::from_str(r#"{"type":"rawOsc","address":"/live/song/delete_track"}"#);
        assert!(r.is_err(), "nicht gelistete Befehle dürfen nicht deserialisierbar sein");
    }

    #[test]
    fn ranges_are_validated() {
        assert!(DawCommand::SetTempo { bpm: 120.0 }.validate().is_ok());
        assert!(DawCommand::SetTempo { bpm: 19.9 }.validate().is_err());
        assert!(DawCommand::SetTempo { bpm: 1000.0 }.validate().is_err());
        assert!(DawCommand::SetTempo { bpm: f32::NAN }.validate().is_err());
        assert!(DawCommand::SetTrackVolume { track: 0, value: 1.01 }.validate().is_err());
        assert!(DawCommand::SetTrackVolume { track: 0, value: 0.0 }.validate().is_ok());
        assert!(DawCommand::SetTrackPanning { track: 0, value: -1.0 }.validate().is_ok());
        assert!(DawCommand::SetTrackPanning { track: 0, value: 1.5 }.validate().is_err());
    }
}
