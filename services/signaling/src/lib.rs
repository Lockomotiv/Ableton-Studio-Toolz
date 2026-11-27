//! Signalisierungsdienst für LOCK-O-MOTIV Connect Studio.
//!
//! Aufgabe: zwei Teilnehmer (Host + Gast) eines Raums finden sich und tauschen
//! WebRTC-Angebote/ICE-Kandidaten aus. Medien, Steuerbefehle, Notizen und Dateien
//! laufen danach direkt (Ende-zu-Ende über DTLS/SRTP) zwischen den Teilnehmern –
//! NICHT über diesen Dienst.
//!
//! Sicherheit:
//! * Ein Raum wird vom Host mit einem zufälligen Einladungsgeheimnis angelegt.
//!   Der Server speichert nur dessen SHA-256-Hash.
//! * Gäste müssen dasselbe Geheimnis vorlegen. Maximal ein Host + ein Gast.
//! * Nachrichten sind auf 64 KiB begrenzt; die erste Nachricht muss binnen 10 s
//!   ein `join` sein.
//! * Optional erzeugt der Server zeitlich begrenzte TURN-Zugangsdaten (coturn
//!   "use-auth-secret"), sodass kein TURN-Geheimnis im Client liegt.
//! * TLS: hinter einem Reverse-Proxy (z. B. Caddy) betreiben, siehe docs.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const JOIN_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone)]
pub struct TurnConfig {
    /// z. B. "turn:turn.example.org:3478?transport=udp"
    pub urls: Vec<String>,
    /// coturn `static-auth-secret`
    pub secret: String,
    pub ttl: Duration,
}

#[derive(Debug, Clone, Default)]
pub struct Config {
    pub stun_urls: Vec<String>,
    pub turn: Option<TurnConfig>,
    pub max_rooms: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    Host,
    Guest,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum ClientMsg {
    Join {
        room: String,
        token: String,
        role: Role,
        name: String,
        /// Nur vom Host: Unix-Zeit (s), ab der Gäste nicht mehr beitreten dürfen.
        #[serde(default)]
        expires_at: Option<u64>,
    },
    Signal { data: Value },
    Leave,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IceServer {
    pub urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum ServerMsg {
    Joined { role: Role, peer_name: Option<String>, ice_servers: Vec<IceServer> },
    PeerJoined { name: String },
    PeerLeft,
    Signal { data: Value },
    Error { code: String, message: String },
}

struct Peer {
    conn: u64,
    name: String,
    tx: mpsc::UnboundedSender<String>,
}

struct Room {
    token_hash: [u8; 32],
    expires_at: Option<u64>,
    host: Option<Peer>,
    guest: Option<Peer>,
}

#[derive(Default)]
pub struct State {
    rooms: Mutex<HashMap<String, Room>>,
    next_conn: AtomicU64,
    /// Zeitpunkte von Join-Versuchen bzw. Fehlversuchen je IP (gleitendes Fenster)
    attempts: Mutex<HashMap<IpAddr, Vec<Instant>>>,
    failures: Mutex<HashMap<IpAddr, Vec<Instant>>>,
}

/// Höchstens so viele Join-Versuche je IP und Minute.
pub const MAX_JOINS_PER_MINUTE: usize = 30;
/// Höchstens so viele fehlgeschlagene Joins (falsches Geheimnis, unbekannter Raum) je IP und Minute.
pub const MAX_FAILURES_PER_MINUTE: usize = 10;

fn over_limit(map: &Mutex<HashMap<IpAddr, Vec<Instant>>>, ip: IpAddr, max: usize, record: bool) -> bool {
    let now = Instant::now();
    let mut m = map.lock().unwrap();
    if m.len() > 10_000 {
        m.retain(|_, v| v.iter().any(|t| now.duration_since(*t) < Duration::from_secs(60)));
    }
    let v = m.entry(ip).or_default();
    v.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
    if record {
        v.push(now);
        v.len() > max
    } else {
        // reine Abfrage: Grenze bereits erreicht?
        v.len() >= max
    }
}

impl State {
    pub fn room_count(&self) -> usize {
        self.rooms.lock().unwrap().len()
    }
}

fn hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

fn valid_room(r: &str) -> bool {
    (8..=64).contains(&r.len()) && r.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn to_json(m: &ServerMsg) -> String {
    serde_json::to_string(m).expect("serialisierbar")
}

/// Zeitlich begrenzte TURN-Zugangsdaten nach dem coturn-REST-Schema:
/// username = "<ablauf-unixzeit>:<raum>", credential = base64(HMAC-SHA1(secret, username)).
pub fn turn_credentials(turn: &TurnConfig, room: &str, now_unix: u64) -> IceServer {
    let username = format!("{}:{}", now_unix + turn.ttl.as_secs(), room);
    let mut mac = Hmac::<sha1::Sha1>::new_from_slice(turn.secret.as_bytes()).expect("HMAC akzeptiert jede Schlüssellänge");
    mac.update(username.as_bytes());
    let credential = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
    IceServer { urls: turn.urls.clone(), username: Some(username), credential: Some(credential) }
}

fn ice_servers(cfg: &Config, room: &str) -> Vec<IceServer> {
    let mut v = Vec::new();
    if !cfg.stun_urls.is_empty() {
        v.push(IceServer { urls: cfg.stun_urls.clone(), username: None, credential: None });
    }
    if let Some(t) = &cfg.turn {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        v.push(turn_credentials(t, room, now));
    }
    v
}

/// Nimmt Verbindungen an, bis der Listener geschlossen wird.
pub async fn serve(listener: TcpListener, cfg: Arc<Config>, state: Arc<State>) {
    loop {
        let Ok((stream, addr)) = listener.accept().await else { continue };
        let cfg = cfg.clone();
        let state = state.clone();
        tokio::spawn(async move {
            handle(stream, addr, cfg, state).await;
        });
    }
}

async fn handle(stream: TcpStream, addr: SocketAddr, cfg: Arc<Config>, state: Arc<State>) {
    let ws_cfg = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_MESSAGE_BYTES));
    let Ok(ws) = tokio_tungstenite::accept_async_with_config(stream, Some(ws_cfg)).await else { return };
    let (mut sink, mut source) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            if sink.send(Message::text(m)).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let conn = state.next_conn.fetch_add(1, Ordering::Relaxed);
    let send_err = |code: &str, message: &str| {
        let _ = tx.send(to_json(&ServerMsg::Error { code: code.into(), message: message.into() }));
    };

    // 1. join
    let first = tokio::time::timeout(JOIN_TIMEOUT, source.next()).await;
    let joined = match first {
        Ok(Some(Ok(Message::Text(t)))) => match serde_json::from_str::<ClientMsg>(&t) {
            Ok(ClientMsg::Join { room, token, role, name, expires_at }) => {
                let ip = addr.ip();
                if over_limit(&state.attempts, ip, MAX_JOINS_PER_MINUTE, true) || over_limit(&state.failures, ip, MAX_FAILURES_PER_MINUTE, false) {
                    Err(("rate-limited", "Zu viele Verbindungsversuche – bitte eine Minute warten"))
                } else {
                    let r = join(&state, &cfg, conn, &tx, room, token, role, name.chars().take(64).collect(), expires_at);
                    if matches!(r, Err((c, _)) if c == "forbidden" || c == "no-room" || c == "expired") {
                        over_limit(&state.failures, ip, MAX_FAILURES_PER_MINUTE, true);
                    }
                    r
                }
            }
            _ => Err(("bad-request", "Erste Nachricht muss 'join' sein")),
        },
        _ => Err(("bad-request", "Kein 'join' innerhalb von 10 s")),
    };
    let (room, role) = match joined {
        Ok(v) => v,
        Err((code, msg)) => {
            send_err(code, msg);
            drop(tx);
            let _ = writer.await;
            return;
        }
    };

    // 2. Weiterleitung
    while let Some(msg) = source.next().await {
        let Ok(Message::Text(t)) = msg else {
            if matches!(msg, Ok(Message::Close(_)) | Err(_)) {
                break;
            }
            continue;
        };
        match serde_json::from_str::<ClientMsg>(&t) {
            Ok(ClientMsg::Signal { data }) => {
                let rooms = state.rooms.lock().unwrap();
                if let Some(r) = rooms.get(&room) {
                    let other = match role {
                        Role::Host => &r.guest,
                        Role::Guest => &r.host,
                    };
                    if let Some(p) = other {
                        let _ = p.tx.send(to_json(&ServerMsg::Signal { data }));
                    }
                }
            }
            Ok(ClientMsg::Leave) => break,
            _ => send_err("bad-request", "Unbekannte Nachricht"),
        }
    }

    // 3. Aufräumen
    {
        let mut rooms = state.rooms.lock().unwrap();
        if let Some(r) = rooms.get_mut(&room) {
            let slot = match role {
                Role::Host => &mut r.host,
                Role::Guest => &mut r.guest,
            };
            if slot.as_ref().map(|p| p.conn) == Some(conn) {
                *slot = None;
                let other = match role {
                    Role::Host => &r.guest,
                    Role::Guest => &r.host,
                };
                if let Some(p) = other {
                    let _ = p.tx.send(to_json(&ServerMsg::PeerLeft));
                }
            }
            if r.host.is_none() && r.guest.is_none() {
                rooms.remove(&room);
            }
        }
    }
    drop(tx);
    let _ = writer.await;
}

#[allow(clippy::too_many_arguments)]
fn join(
    state: &State,
    cfg: &Config,
    conn: u64,
    tx: &mpsc::UnboundedSender<String>,
    room: String,
    token: String,
    role: Role,
    name: String,
    expires_at: Option<u64>,
) -> Result<(String, Role), (&'static str, &'static str)> {
    if !valid_room(&room) {
        return Err(("bad-room", "Ungültige Raum-ID"));
    }
    if token.len() < 16 || token.len() > 256 {
        return Err(("bad-token", "Ungültiges Einladungsgeheimnis"));
    }
    let h = hash(&token);
    let mut rooms = state.rooms.lock().unwrap();
    let max = if cfg.max_rooms == 0 { 1000 } else { cfg.max_rooms };
    if !rooms.contains_key(&room) {
        if role == Role::Guest {
            return Err(("no-room", "Sitzung nicht gefunden – ist der Host online?"));
        }
        if rooms.len() >= max {
            return Err(("server-full", "Server ausgelastet"));
        }
        rooms.insert(room.clone(), Room { token_hash: h, expires_at: None, host: None, guest: None });
    }
    let r = rooms.get_mut(&room).unwrap();
    if r.token_hash != h {
        return Err(("forbidden", "Einladung ungültig"));
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    match role {
        // Der Host legt die Gültigkeit fest (und darf sie bei Wiederverbindung bestätigen).
        Role::Host => r.expires_at = expires_at,
        Role::Guest => {
            if r.expires_at.is_some_and(|e| now >= e) {
                return Err(("expired", "Diese Einladung ist abgelaufen – bitte beim Host eine neue anfordern"));
            }
        }
    }
    let (slot, other) = match role {
        Role::Host => (&mut r.host, &r.guest),
        Role::Guest => (&mut r.guest, &r.host),
    };
    if slot.is_some() {
        return Err(("occupied", "Diese Rolle ist in der Sitzung bereits belegt"));
    }
    let peer_name = other.as_ref().map(|p| p.name.clone());
    if let Some(p) = other {
        let _ = p.tx.send(to_json(&ServerMsg::PeerJoined { name: name.clone() }));
    }
    *slot = Some(Peer { conn, name, tx: tx.clone() });
    let _ = tx.send(to_json(&ServerMsg::Joined { role, peer_name, ice_servers: ice_servers(cfg, &room) }));
    Ok((room, role))
}

/// Startet den Dienst auf `bind` und liefert die tatsächlich gebundene Adresse.
pub async fn start(bind: SocketAddr, cfg: Config) -> std::io::Result<(SocketAddr, Arc<State>, tokio::task::JoinHandle<()>)> {
    let listener = TcpListener::bind(bind).await?;
    let addr = listener.local_addr()?;
    let state = Arc::new(State::default());
    let handle = tokio::spawn(serve(listener, Arc::new(cfg), state.clone()));
    Ok((addr, state, handle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turn_credentials_match_coturn_scheme() {
        // Referenzwert unabhängig berechnet:
        // echo -n "1000:room1234" | openssl dgst -sha1 -hmac secret -binary | base64
        let t = TurnConfig { urls: vec!["turn:x".into()], secret: "secret".into(), ttl: Duration::from_secs(400) };
        let c = turn_credentials(&t, "room1234", 600);
        assert_eq!(c.username.as_deref(), Some("1000:room1234"));
        assert_eq!(c.credential.as_deref(), Some(crate::tests::REF_CRED));
    }

    /// `echo -n "1000:room1234" | openssl dgst -sha1 -hmac secret -binary | base64`
    pub(crate) const REF_CRED: &str = "3dXZMgtpq2viTSOL401zADAyG5s=";

    #[test]
    fn room_ids_are_validated() {
        assert!(valid_room("abcdEFGH-1234_x"));
        assert!(!valid_room("short"));
        assert!(!valid_room("bad/room/../x"));
    }
}
