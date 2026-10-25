use super::*;
use senpi_desktop_backend_fake::{FakeBackend, RecordingSink, SinkOp};
use senpi_desktop_core::{backend::Backend, error::CoreResult, types::DesktopSessionOptions};
use senpi_desktop_session::BackendFactory;
use std::{sync::mpsc, time::Duration};

struct Factory(mpsc::Sender<RecordingSink>);

impl BackendFactory for Factory {
    fn create(&self, _: &DesktopSessionOptions) -> CoreResult<Box<dyn Backend>> {
        let backend = FakeBackend::new(FakeScenario::default());
        self.0.send(backend.sink()).unwrap();
        Ok(Box::new(backend))
    }
}

/// How long the fixture hold lasts, in seconds; a hold's deadline is the operation timeout plus this.
const HOLD_SECS: u64 = 100;

pub(super) async fn held_client(owner: &Sessions, timeout: Duration) -> (Client, mpsc::Receiver<SinkOp>) {
    let (tx, rx) = mpsc::channel();
    let mut config = config();
    config.timeouts.operation = timeout;
    let engine = owner.open_with(config, Factory(tx)).unwrap();
    rx.recv().unwrap();
    let mut client = Client::with_engine(engine);
    client
        .call(1, "session.open", json!({"allowHostRelayOnlyStop":true}))
        .await;
    let sink = rx.recv().unwrap();
    let events = sink.subscribe();
    client
        .call(
            2,
            "stopPath.start",
            json!({"chord":"ctrl+alt+shift+escape"}),
        )
        .await;
    client.call(3, "stopPath.heartbeat", json!({})).await;
    client
        .call(
            4,
            "control.grant",
            json!({"reason":"fixture","confirmationId":"fixture"}),
        )
        .await;
    client
        .send(
            5,
            "holdKeys",
            json!({
                "target":"desktop", "keys":["shift"], "duration":HOLD_SECS,
                "opts":{"deliveryMode":"foreground"}
            }),
        )
        .await;
    let events = event(events, |op| {
        matches!(op, SinkOp::HeldKey { down: true, .. })
    })
    .await;
    (client, events)
}

async fn event(
    events: mpsc::Receiver<SinkOp>,
    predicate: fn(&SinkOp) -> bool,
) -> mpsc::Receiver<SinkOp> {
    tokio::task::spawn_blocking(move || loop {
        let op = events.recv_timeout(Duration::from_secs(5)).unwrap();
        if predicate(&op) {
            return events;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn disconnect_releases_held_input() {
    // given: subscribe and wait for the actual key-down before disconnecting.
    let owner = Sessions::new();
    let (client, events) = held_client(&owner, Duration::from_secs(120)).await;
    // when
    client.close().await;
    // then
    event(events, |op| {
        matches!(op, SinkOp::HeldKey { down: false, .. })
    })
    .await;
}

#[tokio::test]
async fn global_stop_releases_another_connections_held_input() {
    // given
    let owner = Sessions::new();
    let (mut a, events) = held_client(&owner, Duration::from_secs(120)).await;
    let mut b = Client::new(&owner);
    // when
    b.call(1, "stopPath.stop", json!({"source":"api"})).await;
    // then
    event(events, |op| {
        matches!(op, SinkOp::HeldKey { down: false, .. })
    })
    .await;
    loop {
        let reply = a.next().await;
        if reply["id"] == 5 {
            assert_eq!(reply["error"]["data"]["code"], "Suspended");
            break;
        }
    }
    a.close().await;
    b.close().await;
}

#[tokio::test]
async fn client_timeout_leaves_other_connection_and_agent_alive() {
    // given: virtual time starts only after the real backend pressed the key.
    let owner = Sessions::new();
    let (mut a, events) = held_client(&owner, Duration::from_secs(30)).await;
    let mut b = Client::new(&owner);
    tokio::time::pause();
    // when: virtual time passes the hold's deadline (operation timeout plus the hold).
    tokio::time::advance(Duration::from_secs(30 + HOLD_SECS + 1)).await;
    // The release then runs on the real worker thread under the close budget, so
    // real time resumes before the reply is awaited; paused time must not
    // auto-advance past that budget while the worker is still releasing.
    tokio::time::resume();
    // then
    loop {
        let reply = a.next().await;
        if reply["id"] == 5 {
            assert_eq!(reply["error"]["data"]["code"], "Timeout");
            break;
        }
    }
    event(events, |op| {
        matches!(op, SinkOp::HeldKey { down: false, .. })
    })
    .await;
    let reply = b.call(1, "engine.hello", json!({})).await;
    assert!(reply.get("result").is_some(), "{reply}");
    a.close().await;
    b.close().await;
}
