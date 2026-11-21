//! Echter AbletonOSC-Adapter.
//!
//! Verifiziert gegen AbletonOSC Commit 0ca68214bd62c9b5cb641ca34006cfd70ba94430
//! (siehe docs/architecture/abletonosc-api.md):
//! * AbletonOSC empfängt auf UDP 11000 und antwortet IMMER an `<Absender-IP>:11001`.
//! * `set`-Befehle und Methodenaufrufe liefern KEINE Antwort → wir verifizieren
//!   durch anschließendes Zurücklesen des Zustands.
//! * Antworten auf Spur-/Slot-Abfragen tragen die Indizes als erste Argumente.
//! * Fehler werden asynchron als `/live/error <text>` gemeldet.
//! * AbletonOSC verarbeitet eingehende Pakete einmal pro Live-Tick (~100 ms).
//!
//! Sicherheit: Dieser Adapter bindet ausschließlich an 127.0.0.1 und sendet
//! ausschließlich an 127.0.0.1. Ein anderer Host ist nicht konfigurierbar.

use std::collections::{HashMap, VecDeque};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use futures_util::future::join_all;
use rosc::{OscMessage, OscPacket, OscType};
use tokio::net::UdpSocket;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::metrics::{MetricsSummary, OscMetrics};
use crate::*;

pub const DEFAULT_SEND_PORT: u16 = 11000;
pub const DEFAULT_LISTEN_PORT: u16 = 11001;
const OSC_HOST: Ipv4Addr = Ipv4Addr::LOCALHOST;
const VERIFY_WINDOW: Duration = Duration::from_millis(1200);
const VERIFY_POLL: Duration = Duration::from_millis(40);
const MAX_ERRORS: usize = 100;

#[derive(Debug, Clone)]
pub struct OscConfig {
    /// Port, auf dem AbletonOSC lauscht (Standard 11000).
    pub send_port: u16,
    /// Port, an den AbletonOSC antwortet (Standard 11001, in AbletonOSC fest kodiert).
    pub listen_port: u16,
    pub timeout: Duration,
}

impl Default for OscConfig {
    fn default() -> Self {
        Self {
            send_port: DEFAULT_SEND_PORT,
            listen_port: DEFAULT_LISTEN_PORT,
            timeout: Duration::from_millis(1500),
        }
    }
}

type Waiters = HashMap<String, VecDeque<oneshot::Sender<Vec<OscType>>>>;

#[derive(Default)]
struct Shared {
    pending: Mutex<Waiters>,
    errors: Mutex<VecDeque<OscErrorEvent>>,
    connection: Mutex<Option<ConnectionState>>,
    live_version: Mutex<Option<String>>,
    metrics: OscMetrics,
}

impl Shared {
    fn set_connection(&self, c: ConnectionState) {
        *self.connection.lock().unwrap() = Some(c);
    }

    fn push_error(&self, message: String) {
        self.push_event("error", message)
    }

    fn push_event(&self, level: &str, message: String) {
        let mut e = self.errors.lock().unwrap();
        if e.len() == MAX_ERRORS {
            e.pop_front();
        }
        e.push_back(OscErrorEvent { at_ms: now_ms(), level: level.into(), message });
    }

    fn dispatch(&self, msg: OscMessage) {
        match msg.addr.as_str() {
            "/live/error" => {
                let text = msg
                    .args
                    .iter()
                    .map(arg_to_key)
                    .collect::<Vec<_>>()
                    .join(" ");
                self.push_error(text);
                return;
            }
            "/live/startup" => {
                // AbletonOSC wurde (neu) geladen – Version neu erfragen.
                *self.live_version.lock().unwrap() = None;
                self.push_event("info", "AbletonOSC wurde (neu) gestartet (/live/startup)".into());
                return;
            }
            _ => {}
        }
        let mut pending = self.pending.lock().unwrap();
        // Spezifischsten Schlüssel zuerst: Adresse + bis zu 2 Index-Argumente.
        for n in (0..=msg.args.len().min(2)).rev() {
            let key = make_key(&msg.addr, &msg.args[..n]);
            if let Some(q) = pending.get_mut(&key) {
                while let Some(tx) = q.pop_front() {
                    if tx.send(msg.args.clone()).is_ok() {
                        if q.is_empty() {
                            pending.remove(&key);
                        }
                        return;
                    }
                }
                pending.remove(&key);
            }
        }
        // Unaufgeforderte Nachricht (z. B. Listener) – in Sprint 1 ignoriert.
    }
}

fn arg_to_key(a: &OscType) -> String {
    match a {
        OscType::Int(i) => i.to_string(),
        OscType::Long(i) => i.to_string(),
        OscType::Float(f) => f.to_string(),
        OscType::Double(f) => f.to_string(),
        OscType::String(s) => s.clone(),
        OscType::Bool(b) => b.to_string(),
        OscType::Nil => "nil".into(),
        other => format!("{other:?}"),
    }
}

fn make_key(addr: &str, key_args: &[OscType]) -> String {
    let mut k = addr.to_string();
    for a in key_args {
        k.push('|');
        k.push_str(&arg_to_key(a));
    }
    k
}

fn flatten(p: OscPacket, out: &mut Vec<OscMessage>) {
    match p {
        OscPacket::Message(m) => out.push(m),
        OscPacket::Bundle(b) => b.content.into_iter().for_each(|c| flatten(c, out)),
    }
}

pub(crate) fn as_f32(v: &[OscType], i: usize, what: &str) -> Result<f32, DawError> {
    match v.get(i) {
        Some(OscType::Float(f)) => Ok(*f),
        Some(OscType::Double(f)) => Ok(*f as f32),
        Some(OscType::Int(n)) => Ok(*n as f32),
        other => Err(DawError::Protocol(format!("{what}: Zahl erwartet, erhalten {other:?}"))),
    }
}

pub(crate) fn as_bool(v: &[OscType], i: usize, what: &str) -> Result<bool, DawError> {
    match v.get(i) {
        Some(OscType::Bool(b)) => Ok(*b),
        Some(OscType::Int(n)) => Ok(*n != 0),
        Some(OscType::Float(f)) => Ok(*f != 0.0),
        other => Err(DawError::Protocol(format!("{what}: Bool erwartet, erhalten {other:?}"))),
    }
}

pub(crate) fn as_u32(v: &[OscType], i: usize, what: &str) -> Result<u32, DawError> {
    match v.get(i) {
        Some(OscType::Int(n)) if *n >= 0 => Ok(*n as u32),
        Some(OscType::Long(n)) if *n >= 0 => Ok(*n as u32),
        other => Err(DawError::Protocol(format!("{what}: Ganzzahl erwartet, erhalten {other:?}"))),
    }
}

pub struct AbletonOscAdapter {
    socket: Arc<UdpSocket>,
    target: SocketAddr,
    cfg: OscConfig,
    shared: Arc<Shared>,
    recv_task: JoinHandle<()>,
}

impl Drop for AbletonOscAdapter {
    fn drop(&mut self) {
        self.recv_task.abort();
    }
}

impl AbletonOscAdapter {
    /// Öffnet den lokalen Antwortport (127.0.0.1:listen_port) und startet den Empfang.
    pub async fn bind(cfg: OscConfig) -> Result<Self, DawError> {
        let local = SocketAddrV4::new(OSC_HOST, cfg.listen_port);
        let socket = UdpSocket::bind(local).await.map_err(|e| DawError::BindFailed {
            port: cfg.listen_port,
            reason: e.to_string(),
        })?;
        let socket = Arc::new(socket);
        let shared = Arc::new(Shared::default());
        let recv_task = tokio::spawn(recv_loop(socket.clone(), shared.clone()));
        Ok(Self {
            socket,
            target: SocketAddr::V4(SocketAddrV4::new(OSC_HOST, cfg.send_port)),
            cfg,
            shared,
            recv_task,
        })
    }

    pub fn config(&self) -> &OscConfig {
        &self.cfg
    }

    async fn send(&self, addr: &str, args: Vec<OscType>) -> Result<(), DawError> {
        let pkt = OscPacket::Message(OscMessage { addr: addr.to_string(), args });
        let buf = rosc::encoder::encode(&pkt).map_err(|e| DawError::Protocol(e.to_string()))?;
        self.socket
            .send_to(&buf, self.target)
            .await
            .map_err(|e| DawError::Io(e.to_string()))?;
        Ok(())
    }

    /// Sendet eine Abfrage und wartet auf die Antwort mit derselben Adresse
    /// (und denselben `key_args` führenden Index-Argumenten).
    async fn query(
        &self,
        addr: &str,
        args: Vec<OscType>,
        key_args: usize,
    ) -> Result<Vec<OscType>, DawError> {
        let key = make_key(addr, &args[..key_args.min(args.len())]);
        let (tx, rx) = oneshot::channel();
        self.shared
            .pending
            .lock()
            .unwrap()
            .entry(key.clone())
            .or_default()
            .push_back(tx);
        let start = Instant::now();
        if let Err(e) = self.send(addr, args).await {
            self.cleanup(&key);
            self.shared.set_connection(ConnectionState::Unreachable);
            return Err(e);
        }
        match tokio::time::timeout(self.cfg.timeout, rx).await {
            Ok(Ok(v)) => {
                self.shared
                    .metrics
                    .record(addr, start.elapsed().as_secs_f64() * 1000.0);
                self.shared.set_connection(ConnectionState::Connected);
                Ok(v)
            }
            Ok(Err(_)) => Err(DawError::Closed),
            Err(_) => {
                self.cleanup(&key);
                self.shared.metrics.record_timeout();
                self.shared.set_connection(ConnectionState::Unreachable);
                Err(DawError::Timeout(addr.to_string()))
            }
        }
    }

    fn cleanup(&self, key: &str) {
        let mut p = self.shared.pending.lock().unwrap();
        if let Some(q) = p.get_mut(key) {
            q.retain(|s| !s.is_closed());
            if q.is_empty() {
                p.remove(key);
            }
        }
    }

    async fn get_song_bool(&self, prop: &str) -> Result<bool, DawError> {
        let v = self.query(&format!("/live/song/get/{prop}"), vec![], 0).await?;
        as_bool(&v, 0, prop)
    }

    async fn get_song_f32(&self, prop: &str) -> Result<f32, DawError> {
        let v = self.query(&format!("/live/song/get/{prop}"), vec![], 0).await?;
        as_f32(&v, 0, prop)
    }

    async fn get_song_u32(&self, prop: &str) -> Result<u32, DawError> {
        let v = self.query(&format!("/live/song/get/{prop}"), vec![], 0).await?;
        as_u32(&v, 0, prop)
    }

    async fn get_track_f32(&self, prop: &str, track: u32) -> Result<f32, DawError> {
        let v = self
            .query(&format!("/live/track/get/{prop}"), vec![OscType::Int(track as i32)], 1)
            .await?;
        // Antwort: (track_index, value)
        as_f32(&v, 1, prop)
    }

    async fn get_clip_slot_bool(&self, prop: &str, track: u32, slot: u32) -> Result<bool, DawError> {
        let v = self
            .query(
                &format!("/live/clip_slot/get/{prop}"),
                vec![OscType::Int(track as i32), OscType::Int(slot as i32)],
                2,
            )
            .await?;
        // Antwort: (track_index, clip_index, value)
        as_bool(&v, 2, prop)
    }

    pub async fn live_version(&self) -> Result<String, DawError> {
        if let Some(v) = self.shared.live_version.lock().unwrap().clone() {
            return Ok(v);
        }
        let v = self.query("/live/application/get/version", vec![], 0).await?;
        let s = format!("{}.{}", as_u32(&v, 0, "major")?, as_u32(&v, 1, "minor")?);
        *self.shared.live_version.lock().unwrap() = Some(s.clone());
        Ok(s)
    }

    /// Prüft, welche der vom Client benötigten Lese-Adressen antworten.
    /// Schreibende Adressen werden hier bewusst NICHT ausgelöst (Seiteneffekte).
    pub async fn read_api_report(&self) -> Vec<(String, Result<(), DawError>)> {
        let mut out = Vec::new();
        for addr in [
            "/live/application/get/version",
            "/live/song/get/is_playing",
            "/live/song/get/tempo",
            "/live/song/get/loop",
            "/live/song/get/is_ableton_link_enabled",
            "/live/song/get/num_tracks",
            "/live/song/get/num_scenes",
            "/live/song/get/track_names",
        ] {
            let r = self.query(addr, vec![], 0).await.map(|_| ());
            out.push((addr.to_string(), r));
        }
        if let Ok(n) = self.get_song_u32("num_tracks").await {
            if n > 0 {
                for prop in ["volume", "panning"] {
                    let r = self.get_track_f32(prop, 0).await.map(|_| ());
                    out.push((format!("/live/track/get/{prop}"), r));
                }
                if self.get_song_u32("num_scenes").await.unwrap_or(0) > 0 {
                    for prop in ["has_clip", "is_triggered", "is_playing"] {
                        let r = self.get_clip_slot_bool(prop, 0, 0).await.map(|_| ());
                        out.push((format!("/live/clip_slot/get/{prop}"), r));
                    }
                }
            }
        }
        out
    }

    /// Fragt wiederholt ab, bis `pred` erfüllt ist oder das Zeitfenster abläuft.
    async fn verify<F, Fut>(&self, mut read: F, pred: impl Fn(&Fut::Output) -> bool) -> Result<bool, DawError>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future,
        Fut::Output: IntoResult,
    {
        let deadline = Instant::now() + VERIFY_WINDOW;
        loop {
            let r = read().await;
            r.as_err()?;
            if pred(&r) {
                return Ok(true);
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            tokio::time::sleep(VERIFY_POLL).await;
        }
    }

    async fn ensure_track(&self, track: u32) -> Result<(), DawError> {
        let n = self.get_song_u32("num_tracks").await?;
        if track >= n {
            return Err(DawError::InvalidArgument(format!("Spur {track} existiert nicht ({n} Spuren)")));
        }
        Ok(())
    }
}

/// Hilfstrait, damit `verify` Fehler aus dem Lesevorgang weiterreichen kann.
pub trait IntoResult {
    fn as_err(&self) -> Result<(), DawError>;
}
impl<T> IntoResult for Result<T, DawError> {
    fn as_err(&self) -> Result<(), DawError> {
        match self {
            Ok(_) => Ok(()),
            Err(e) => Err(e.clone()),
        }
    }
}

async fn recv_loop(socket: Arc<UdpSocket>, shared: Arc<Shared>) {
    let mut buf = vec![0u8; 65536];
    loop {
        match socket.recv_from(&mut buf).await {
            Ok((n, src)) => {
                if !src.ip().is_loopback() {
                    continue; // nur lokale Pakete akzeptieren
                }
                if let Ok((_, pkt)) = rosc::decoder::decode_udp(&buf[..n]) {
                    let mut msgs = Vec::new();
                    flatten(pkt, &mut msgs);
                    for m in msgs {
                        shared.dispatch(m);
                    }
                }
            }
            Err(_) => {
                // Unter Windows liefert recv_from nach einem ICMP "port unreachable"
                // (AbletonOSC nicht aktiv) WSAECONNRESET. Das ist nicht fatal.
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        }
    }
}

#[async_trait]
impl DawAdapter for AbletonOscAdapter {
    fn kind(&self) -> AdapterKind {
        AdapterKind::AbletonOsc
    }

    fn holds_listen_port(&self) -> Option<u16> {
        Some(self.cfg.listen_port)
    }

    async fn check_read_api(&self) -> Option<Vec<(String, Result<(), DawError>)>> {
        Some(self.read_api_report().await)
    }

    async fn probe(&self) -> ProbeResult {
        let start = Instant::now();
        match self.query("/live/test", vec![], 0).await {
            Ok(v) => {
                let rtt = start.elapsed().as_secs_f64() * 1000.0;
                let ok = matches!(v.first(), Some(OscType::String(s)) if s == "ok");
                let version = self.live_version().await.ok();
                ProbeResult {
                    adapter: AdapterKind::AbletonOsc,
                    reachable: ok,
                    live_version: version.clone(),
                    roundtrip_ms: Some(rtt),
                    message: if ok {
                        format!(
                            "AbletonOSC antwortet (Ableton Live {}).",
                            version.as_deref().unwrap_or("Version unbekannt")
                        )
                    } else {
                        format!("Unerwartete Antwort auf /live/test: {v:?}")
                    },
                }
            }
            Err(e) => ProbeResult {
                adapter: AdapterKind::AbletonOsc,
                reachable: false,
                live_version: None,
                roundtrip_ms: None,
                message: e.to_string(),
            },
        }
    }

    async fn status(&self) -> Result<LiveStatus, DawError> {
        let start = Instant::now();
        let (playing, tempo, looping, tracks, version, link) = tokio::join!(
            self.get_song_bool("is_playing"),
            self.get_song_f32("tempo"),
            self.get_song_bool("loop"),
            self.get_song_u32("num_tracks"),
            self.live_version(),
            self.get_song_bool("is_ableton_link_enabled"),
        );
        Ok(LiveStatus {
            adapter: AdapterKind::AbletonOsc,
            connection: ConnectionState::Connected,
            live_version: version.ok(),
            is_playing: playing?,
            tempo: tempo?,
            loop_enabled: looping?,
            num_tracks: tracks?,
            link_enabled: link.ok(),
            query_ms: start.elapsed().as_secs_f64() * 1000.0,
        })
    }

    async fn tracks(&self) -> Result<Vec<TrackInfo>, DawError> {
        let n = self.get_song_u32("num_tracks").await?;
        let names = self.query("/live/song/get/track_names", vec![], 0).await?;
        let futs = (0..n).map(|i| async move {
            let (vol, pan) = tokio::join!(self.get_track_f32("volume", i), self.get_track_f32("panning", i));
            Ok::<_, DawError>((i, vol?, pan?))
        });
        let mut out = Vec::with_capacity(n as usize);
        for r in join_all(futs).await {
            let (i, volume, panning) = r?;
            let name = match names.get(i as usize) {
                Some(OscType::String(s)) => s.clone(),
                _ => format!("Spur {}", i + 1),
            };
            out.push(TrackInfo { index: i, name, volume, panning });
        }
        Ok(out)
    }

    async fn execute(&self, cmd: DawCommand) -> Result<CommandOutcome, DawError> {
        cmd.validate()?;
        let start = Instant::now();
        if let Some(t) = cmd.track_index() {
            self.ensure_track(t).await?;
        }
        let verified = match cmd {
            DawCommand::Play | DawCommand::ContinuePlaying => {
                let addr = if cmd == DawCommand::Play { "start_playing" } else { "continue_playing" };
                self.send(&format!("/live/song/{addr}"), vec![]).await?;
                self.verify(|| self.get_song_bool("is_playing"), |r| matches!(r, Ok(true))).await?
            }
            DawCommand::Stop => {
                self.send("/live/song/stop_playing", vec![]).await?;
                self.verify(|| self.get_song_bool("is_playing"), |r| matches!(r, Ok(false))).await?
            }
            DawCommand::SetTempo { bpm } => {
                self.send("/live/song/set/tempo", vec![OscType::Float(bpm)]).await?;
                self.verify(|| self.get_song_f32("tempo"), |r| matches!(r, Ok(t) if (t - bpm).abs() < 0.01))
                    .await?
            }
            DawCommand::SetLoop { enabled } => {
                // AbletonOSC-Tests setzen boolesche Song-Properties mit 1/0.
                self.send("/live/song/set/loop", vec![OscType::Int(enabled as i32)]).await?;
                self.verify(|| self.get_song_bool("loop"), |r| matches!(r, Ok(b) if *b == enabled))
                    .await?
            }
            DawCommand::SetLinkEnabled { enabled } => {
                self.send("/live/song/set/is_ableton_link_enabled", vec![OscType::Int(enabled as i32)]).await?;
                self.verify(|| self.get_song_bool("is_ableton_link_enabled"), |r| matches!(r, Ok(b) if *b == enabled))
                    .await?
            }
            DawCommand::SetTrackVolume { track, value } => {
                self.send(
                    "/live/track/set/volume",
                    vec![OscType::Int(track as i32), OscType::Float(value)],
                )
                .await?;
                self.verify(
                    || self.get_track_f32("volume", track),
                    |r| matches!(r, Ok(v) if (v - value).abs() < 0.001),
                )
                .await?
            }
            DawCommand::SetTrackPanning { track, value } => {
                self.send(
                    "/live/track/set/panning",
                    vec![OscType::Int(track as i32), OscType::Float(value)],
                )
                .await?;
                self.verify(
                    || self.get_track_f32("panning", track),
                    |r| matches!(r, Ok(v) if (v - value).abs() < 0.001),
                )
                .await?
            }
            DawCommand::FireClip { track, slot } => {
                // Ungültige Slot-Indizes würden in AbletonOSC einen IndexError auslösen
                // und keine Antwort erzeugen → vorher gegen num_scenes prüfen.
                let scenes = self.get_song_u32("num_scenes").await?;
                if slot >= scenes {
                    return Err(DawError::InvalidArgument(format!(
                        "Slot {slot} existiert nicht ({scenes} Szenen)"
                    )));
                }
                if !self.get_clip_slot_bool("has_clip", track, slot).await? {
                    return Err(DawError::InvalidArgument(format!(
                        "Slot {slot} auf Spur {track} enthält keinen Clip"
                    )));
                }
                self.send(
                    "/live/clip_slot/fire",
                    vec![OscType::Int(track as i32), OscType::Int(slot as i32)],
                )
                .await?;
                self.verify(
                    || async {
                        let (t, p) = tokio::join!(
                            self.get_clip_slot_bool("is_triggered", track, slot),
                            self.get_clip_slot_bool("is_playing", track, slot)
                        );
                        Ok::<bool, DawError>(t? || p?)
                    },
                    |r| matches!(r, Ok(true)),
                )
                .await?
            }
        };
        Ok(CommandOutcome {
            command: cmd,
            adapter: AdapterKind::AbletonOsc,
            verified,
            total_ms: start.elapsed().as_secs_f64() * 1000.0,
            note: if verified {
                None
            } else {
                Some(format!(
                    "Befehl gesendet, aber Live hat den Zielzustand nicht innerhalb von {} ms bestätigt.",
                    VERIFY_WINDOW.as_millis()
                ))
            },
        })
    }

    fn recent_errors(&self) -> Vec<OscErrorEvent> {
        self.shared.errors.lock().unwrap().iter().cloned().collect()
    }

    fn metrics(&self) -> MetricsSummary {
        self.shared.metrics.summary()
    }
}

impl AbletonOscAdapter {
    /// Aktueller Verbindungszustand (nur aus echten Antworten abgeleitet).
    pub fn connection(&self) -> ConnectionState {
        self.shared.connection.lock().unwrap().unwrap_or(ConnectionState::Unknown)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_matching_uses_index_args() {
        assert_eq!(make_key("/live/track/get/volume", &[OscType::Int(3)]), "/live/track/get/volume|3");
        assert_eq!(make_key("/live/song/get/tempo", &[]), "/live/song/get/tempo");
    }

    #[test]
    fn dispatch_routes_track_replies_by_index() {
        let s = Shared::default();
        let (tx0, mut rx0) = oneshot::channel();
        let (tx1, mut rx1) = oneshot::channel();
        {
            let mut p = s.pending.lock().unwrap();
            p.entry("/live/track/get/volume|0".into()).or_default().push_back(tx0);
            p.entry("/live/track/get/volume|1".into()).or_default().push_back(tx1);
        }
        // Antworten in umgekehrter Reihenfolge
        s.dispatch(OscMessage { addr: "/live/track/get/volume".into(), args: vec![OscType::Int(1), OscType::Float(0.2)] });
        s.dispatch(OscMessage { addr: "/live/track/get/volume".into(), args: vec![OscType::Int(0), OscType::Float(0.7)] });
        assert_eq!(rx0.try_recv().unwrap()[1], OscType::Float(0.7));
        assert_eq!(rx1.try_recv().unwrap()[1], OscType::Float(0.2));
    }

    #[test]
    fn error_messages_are_collected() {
        let s = Shared::default();
        s.dispatch(OscMessage { addr: "/live/error".into(), args: vec![OscType::String("boom".into())] });
        assert_eq!(s.errors.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn timeout_when_nobody_listens_marks_unreachable() {
        // Freien Port als "AbletonOSC" wählen, auf dem niemand lauscht.
        let dead = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let send_port = dead.local_addr().unwrap().port();
        drop(dead);
        let a = AbletonOscAdapter::bind(OscConfig {
            send_port,
            listen_port: 0,
            timeout: Duration::from_millis(200),
        })
        .await
        .unwrap();
        let p = a.probe().await;
        assert!(!p.reachable);
        assert!(p.roundtrip_ms.is_none(), "ohne Antwort darf keine RTT gemeldet werden");
        assert_eq!(a.connection(), ConnectionState::Unreachable);
        assert!(matches!(a.status().await, Err(DawError::Timeout(_))));
        assert_eq!(a.metrics().count, 0);
        assert!(a.metrics().timeouts >= 1);
    }

    #[tokio::test]
    async fn bind_is_loopback_only() {
        let a = AbletonOscAdapter::bind(OscConfig { listen_port: 0, ..Default::default() })
            .await
            .unwrap();
        assert!(a.socket.local_addr().unwrap().ip().is_loopback());
        assert!(a.target.ip().is_loopback());
    }

    #[tokio::test]
    async fn bind_conflict_is_reported() {
        let blocker = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = blocker.local_addr().unwrap().port();
        let r = AbletonOscAdapter::bind(OscConfig { listen_port: port, ..Default::default() }).await;
        assert!(matches!(r, Err(DawError::BindFailed { .. })));
    }
}
