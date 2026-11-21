//! Mock-Adapter: simuliert eine Live-Session im Speicher.
//! Jede Antwort ist als `AdapterKind::Mock` / `ConnectionState::Simulated`
//! gekennzeichnet; es werden keine Laufzeiten gemeldet.

use std::sync::Mutex;
use std::time::Instant;

use async_trait::async_trait;

use crate::metrics::MetricsSummary;
use crate::*;

#[derive(Debug, Clone)]
struct MockTrack {
    name: String,
    volume: f32,
    panning: f32,
    clips: Vec<bool>,
    playing_slot: Option<u32>,
}

#[derive(Debug)]
struct MockState {
    is_playing: bool,
    tempo: f32,
    loop_enabled: bool,
    tracks: Vec<MockTrack>,
}

pub struct MockAdapter {
    state: Mutex<MockState>,
}

impl Default for MockAdapter {
    fn default() -> Self {
        let t = |name: &str, clips: &[bool]| MockTrack {
            name: name.into(),
            volume: 0.85,
            panning: 0.0,
            clips: clips.to_vec(),
            playing_slot: None,
        };
        Self {
            state: Mutex::new(MockState {
                is_playing: false,
                tempo: 120.0,
                loop_enabled: false,
                tracks: vec![
                    t("Drums (Mock)", &[true, true, false, false]),
                    t("Bass (Mock)", &[true, false, true, false]),
                    t("Keys (Mock)", &[false, true, false, false]),
                    t("Vocals (Mock)", &[false, false, false, false]),
                ],
            }),
        }
    }
}

impl MockAdapter {
    pub fn new() -> Self {
        Self::default()
    }
}

const MOCK_NOTE: &str = "Mock-Modus: Befehl wurde nur simuliert, nicht an Ableton gesendet.";

#[async_trait]
impl DawAdapter for MockAdapter {
    fn kind(&self) -> AdapterKind {
        AdapterKind::Mock
    }

    async fn probe(&self) -> ProbeResult {
        ProbeResult {
            adapter: AdapterKind::Mock,
            reachable: false,
            live_version: None,
            roundtrip_ms: None,
            message: "Mock-Modus aktiv – es besteht keine Verbindung zu Ableton Live.".into(),
        }
    }

    async fn status(&self) -> Result<LiveStatus, DawError> {
        let s = self.state.lock().unwrap();
        Ok(LiveStatus {
            adapter: AdapterKind::Mock,
            connection: ConnectionState::Simulated,
            live_version: None,
            is_playing: s.is_playing,
            tempo: s.tempo,
            loop_enabled: s.loop_enabled,
            num_tracks: s.tracks.len() as u32,
            query_ms: 0.0,
        })
    }

    async fn tracks(&self) -> Result<Vec<TrackInfo>, DawError> {
        let s = self.state.lock().unwrap();
        Ok(s.tracks
            .iter()
            .enumerate()
            .map(|(i, t)| TrackInfo {
                index: i as u32,
                name: t.name.clone(),
                volume: t.volume,
                panning: t.panning,
            })
            .collect())
    }

    async fn execute(&self, cmd: DawCommand) -> Result<CommandOutcome, DawError> {
        cmd.validate()?;
        let start = Instant::now();
        let mut s = self.state.lock().unwrap();
        if let Some(t) = cmd.track_index() {
            if t as usize >= s.tracks.len() {
                return Err(DawError::InvalidArgument(format!(
                    "Spur {t} existiert nicht ({} Spuren)",
                    s.tracks.len()
                )));
            }
        }
        match cmd {
            DawCommand::Play | DawCommand::ContinuePlaying => s.is_playing = true,
            DawCommand::Stop => s.is_playing = false,
            DawCommand::SetTempo { bpm } => s.tempo = bpm,
            DawCommand::SetLoop { enabled } => s.loop_enabled = enabled,
            DawCommand::SetTrackVolume { track, value } => s.tracks[track as usize].volume = value,
            DawCommand::SetTrackPanning { track, value } => s.tracks[track as usize].panning = value,
            DawCommand::FireClip { track, slot } => {
                let tr = &mut s.tracks[track as usize];
                match tr.clips.get(slot as usize) {
                    Some(true) => {
                        tr.playing_slot = Some(slot);
                        s.is_playing = true;
                    }
                    Some(false) => {
                        return Err(DawError::InvalidArgument(format!(
                            "Slot {slot} auf Spur {track} enthält keinen Clip"
                        )))
                    }
                    None => {
                        return Err(DawError::InvalidArgument(format!(
                            "Slot {slot} existiert nicht"
                        )))
                    }
                }
            }
        }
        Ok(CommandOutcome {
            command: cmd,
            adapter: AdapterKind::Mock,
            verified: true,
            total_ms: start.elapsed().as_secs_f64() * 1000.0,
            note: Some(MOCK_NOTE.into()),
        })
    }

    fn recent_errors(&self) -> Vec<OscErrorEvent> {
        Vec::new()
    }

    fn metrics(&self) -> MetricsSummary {
        MetricsSummary::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn play_stop_roundtrip() {
        let m = MockAdapter::new();
        assert!(!m.status().await.unwrap().is_playing);
        m.execute(DawCommand::Play).await.unwrap();
        assert!(m.status().await.unwrap().is_playing);
        m.execute(DawCommand::Stop).await.unwrap();
        assert!(!m.status().await.unwrap().is_playing);
    }

    #[tokio::test]
    async fn mock_is_clearly_labelled() {
        let m = MockAdapter::new();
        let s = m.status().await.unwrap();
        assert_eq!(s.adapter, AdapterKind::Mock);
        assert_eq!(s.connection, ConnectionState::Simulated);
        let p = m.probe().await;
        assert!(!p.reachable, "Mock darf keine erreichbare Ableton-Verbindung melden");
        let o = m.execute(DawCommand::Play).await.unwrap();
        assert!(o.note.unwrap().contains("Mock"));
    }

    #[tokio::test]
    async fn invalid_track_rejected() {
        let m = MockAdapter::new();
        let r = m.execute(DawCommand::SetTrackVolume { track: 99, value: 0.5 }).await;
        assert!(matches!(r, Err(DawError::InvalidArgument(_))));
    }

    #[tokio::test]
    async fn fire_empty_slot_rejected() {
        let m = MockAdapter::new();
        assert!(m.execute(DawCommand::FireClip { track: 3, slot: 0 }).await.is_err());
        assert!(m.execute(DawCommand::FireClip { track: 0, slot: 0 }).await.is_ok());
    }
}
