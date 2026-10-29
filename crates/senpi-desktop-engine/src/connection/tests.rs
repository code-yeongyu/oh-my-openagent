use std::path::PathBuf;
use std::time::Duration;

use senpi_desktop_core::methods::Notification;
use senpi_desktop_core::protocol_results::EscapeStopped;
use senpi_desktop_session::{BackendSelection, SessionTimeouts};
use serde_json::json;

use super::*;
use crate::config::EngineConfig;

#[tokio::test]
async fn escape_notification_wakes_an_idle_connection_without_a_heartbeat() {
    let engine = Arc::new(Engine::start(EngineConfig {
        selection: BackendSelection::FakeFile(PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"), "/../senpi-desktop-backend-fake/fixtures/escape-stop.json",
        ))),
        timeouts: SessionTimeouts::default(),
        fake_clock: true,
    }).unwrap());
    let (client, server) = tokio::io::duplex(4096);
    let (read, write) = tokio::io::split(server);
    let connection = tokio::spawn(serve_connection(Arc::clone(&engine), read, write));
    let mut client = BufReader::new(client);
    let mut line = String::new();
    let next = client.read_line(&mut line);

    // The output reader exists before the event; no RPC or heartbeat is sent.
    engine.outbox().push(Notification::EscapeStopped, &EscapeStopped { escape_stops: 1 });
    let received = tokio::time::timeout(Duration::from_secs(30), next).await;
    client.get_mut().shutdown().await.unwrap();
    tokio::time::timeout(Duration::from_secs(30), connection).await.unwrap().unwrap().unwrap();

    assert!(received.expect("Escape must wake the idle host").unwrap() > 0);
    assert_eq!(serde_json::from_str::<Value>(&line).unwrap(), json!({
        "jsonrpc": "2.0", "method": "escape.stopped", "params": { "escapeStops": 1 },
    }));
}
