//! Integrationstests: echte WebSocket-Verbindungen gegen den Dienst.
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use lom_signaling::{start, Config, TurnConfig};
use serde_json::{json, Value};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

async fn server(cfg: Config) -> (String, std::sync::Arc<lom_signaling::State>) {
    let (addr, state, _h) = start("127.0.0.1:0".parse().unwrap(), cfg).await.unwrap();
    (format!("ws://{addr}"), state)
}

async fn connect(url: &str) -> Ws {
    connect_async(url).await.unwrap().0
}

async fn send(ws: &mut Ws, v: Value) {
    ws.send(Message::text(v.to_string())).await.unwrap();
}

async fn recv(ws: &mut Ws) -> Value {
    let m = tokio::time::timeout(Duration::from_secs(3), ws.next()).await.expect("Timeout").unwrap().unwrap();
    serde_json::from_str(m.to_text().unwrap()).unwrap()
}

const ROOM: &str = "testroom-0001";
const TOKEN: &str = "0123456789abcdef0123456789abcdef";

async fn join(url: &str, role: &str, token: &str, name: &str) -> (Ws, Value) {
    let mut ws = connect(url).await;
    send(&mut ws, json!({"type":"join","room":ROOM,"token":token,"role":role,"name":name})).await;
    let r = recv(&mut ws).await;
    (ws, r)
}

#[tokio::test]
async fn host_and_guest_exchange_signals() {
    let (url, state) = server(Config { stun_urls: vec!["stun:stun.example:3478".into()], ..Default::default() }).await;
    let (mut host, r) = join(&url, "host", TOKEN, "Host").await;
    assert_eq!(r["type"], "joined");
    assert_eq!(r["peerName"], Value::Null);
    assert_eq!(r["iceServers"][0]["urls"][0], "stun:stun.example:3478");

    let (mut guest, r) = join(&url, "guest", TOKEN, "Gast").await;
    assert_eq!(r["type"], "joined");
    assert_eq!(r["peerName"], "Host");
    assert_eq!(recv(&mut host).await, json!({"type":"peerJoined","name":"Gast"}));

    send(&mut host, json!({"type":"signal","data":{"sdp":"offer"}})).await;
    assert_eq!(recv(&mut guest).await, json!({"type":"signal","data":{"sdp":"offer"}}));
    send(&mut guest, json!({"type":"signal","data":{"sdp":"answer"}})).await;
    assert_eq!(recv(&mut host).await, json!({"type":"signal","data":{"sdp":"answer"}}));

    guest.close(None).await.unwrap();
    assert_eq!(recv(&mut host).await, json!({"type":"peerLeft"}));
    host.close(None).await.unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(state.room_count(), 0, "leere Räume werden entfernt");
}

#[tokio::test]
async fn wrong_token_and_missing_room_are_rejected() {
    let (url, _) = server(Config::default()).await;
    let (_g, r) = join(&url, "guest", TOKEN, "Gast").await;
    assert_eq!(r["code"], "no-room");
    let (_host, _) = join(&url, "host", TOKEN, "Host").await;
    let (_g, r) = join(&url, "guest", "ffffffffffffffffffffffffffffffff", "Angreifer").await;
    assert_eq!(r["code"], "forbidden");
}

#[tokio::test]
async fn third_participant_is_rejected() {
    let (url, _) = server(Config::default()).await;
    let (_h, _) = join(&url, "host", TOKEN, "Host").await;
    let (_g, _) = join(&url, "guest", TOKEN, "Gast").await;
    let (_g2, r) = join(&url, "guest", TOKEN, "Dritter").await;
    assert_eq!(r["code"], "occupied");
    let (_h2, r) = join(&url, "host", TOKEN, "Zweiter Host").await;
    assert_eq!(r["code"], "occupied");
}

#[tokio::test]
async fn guest_can_rejoin_after_disconnect() {
    let (url, _) = server(Config::default()).await;
    let (mut host, _) = join(&url, "host", TOKEN, "Host").await;
    let (mut g, _) = join(&url, "guest", TOKEN, "Gast").await;
    recv(&mut host).await; // peerJoined
    g.close(None).await.unwrap();
    assert_eq!(recv(&mut host).await["type"], "peerLeft");
    let (_g, r) = join(&url, "guest", TOKEN, "Gast").await;
    assert_eq!(r["type"], "joined");
    assert_eq!(recv(&mut host).await["type"], "peerJoined");
}

#[tokio::test]
async fn first_message_must_be_join_and_size_is_limited() {
    let (url, _) = server(Config::default()).await;
    let mut ws = connect(&url).await;
    send(&mut ws, json!({"type":"signal","data":1})).await;
    assert_eq!(recv(&mut ws).await["code"], "bad-request");

    let (mut host, _) = join(&url, "host", TOKEN, "Host").await;
    let big = "x".repeat(70 * 1024);
    let _ = host.send(Message::text(json!({"type":"signal","data":big}).to_string())).await;
    // Verbindung wird vom Server wegen Überschreitung geschlossen
    let next = tokio::time::timeout(Duration::from_secs(3), host.next()).await.unwrap();
    assert!(matches!(next, None | Some(Err(_)) | Some(Ok(Message::Close(_)))), "{next:?}");
}

#[tokio::test]
async fn turn_credentials_are_issued_without_exposing_secret() {
    let (url, _) = server(Config {
        stun_urls: vec![],
        turn: Some(TurnConfig { urls: vec!["turn:t.example:3478".into()], secret: "s3cr3t".into(), ttl: Duration::from_secs(60) }),
        max_rooms: 0,
    })
    .await;
    let (_h, r) = join(&url, "host", TOKEN, "Host").await;
    let ice = &r["iceServers"][0];
    assert!(ice["username"].as_str().unwrap().ends_with(&format!(":{ROOM}")));
    assert!(!r.to_string().contains("s3cr3t"));
}
