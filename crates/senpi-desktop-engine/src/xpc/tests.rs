use super::*;
use senpi_desktop_backend_fake::{FakeBackend, FakeScenario, RecordingSink, SinkOp};
use senpi_desktop_core::{backend::Backend, error::CoreResult};
use senpi_desktop_session::BackendFactory;
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};
use tokio::sync::{
    mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender},
    Mutex, Notify,
};

struct TestStream {
    input: Mutex<UnboundedReceiver<Vec<u8>>>,
    output: UnboundedSender<Vec<u8>>,
    closed: AtomicBool,
    changed: Notify,
}

impl FrameStream for TestStream {
    async fn receive(&self) -> Option<Vec<u8>> {
        let notified = self.changed.notified();
        let mut input = self.input.lock().await;
        if self.closed.load(Ordering::SeqCst) {
            return None;
        }
        let frame = tokio::select! { frame = input.recv() => frame, _ = notified => None };
        if frame.is_none() {
            self.close();
        }
        frame
    }
    fn send(&self, frame: &[u8]) -> Result<(), senpi_desktop_xpc::TransportError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(senpi_desktop_xpc::TransportError::Closed);
        }
        self.output
            .send(frame.to_vec())
            .map_err(|_| senpi_desktop_xpc::TransportError::Closed)
    }
    fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.changed.notify_waiters();
    }
}

struct Factory(mpsc::Sender<RecordingSink>);
impl BackendFactory for Factory {
    fn create(&self, _: &DesktopSessionOptions) -> CoreResult<Box<dyn Backend>> {
        let backend = FakeBackend::new(FakeScenario::default());
        self.0.send(backend.sink()).unwrap();
        Ok(Box::new(backend))
    }
}

struct Client {
    input: UnboundedSender<Vec<u8>>,
    output: UnboundedReceiver<Vec<u8>>,
}
impl Client {
    fn send(&self, id: u64, method: &str, params: Value) {
        self.input
            .send(
                serde_json::to_vec(&json!({
                    "jsonrpc":"2.0", "id":id, "method":method, "params":params,
                }))
                .unwrap(),
            )
            .unwrap();
    }
    async fn call(&mut self, id: u64, method: &str, params: Value) -> Value {
        self.send(id, method, params);
        loop {
            let bytes = tokio::time::timeout(Duration::from_secs(5), self.output.recv())
                .await
                .unwrap()
                .unwrap();
            let reply: Value = serde_json::from_slice(&bytes).unwrap();
            if reply["id"] == id {
                return reply;
            }
        }
    }
}

fn connection(
    owner: Arc<Sessions>,
) -> (
    Client,
    tokio::task::JoinHandle<()>,
    mpsc::Receiver<RecordingSink>,
) {
    let (input, frames) = unbounded_channel();
    let (output, replies) = unbounded_channel();
    let (sinks, observed) = mpsc::channel();
    let opener = Arc::clone(&owner);
    let stream = TestStream {
        input: Mutex::new(frames),
        output,
        closed: AtomicBool::new(false),
        changed: Notify::new(),
    };
    let task = tokio::spawn(serve(stream, owner, move |mut config| {
        config.timeouts.operation = Duration::from_secs(120);
        opener.open_with(config, Factory(sinks))
    }));
    (
        Client {
            input,
            output: replies,
        },
        task,
        observed,
    )
}

#[tokio::test]
async fn r2_h1_real_serve_split_disconnect_releases_input_queue_and_control() {
    // given: the actual xpc::serve function creates both splits and the router.
    let owner = Arc::new(Sessions::new());
    let (mut client, mut serving, sinks) = connection(Arc::clone(&owner));
    client
        .call(1, "session.open", json!({"allowHostRelayOnlyStop":true}))
        .await;
    let sink = sinks.try_iter().last().unwrap();
    let events = sink.subscribe();
    client
        .call(
            2,
            "stopPath.start",
            json!({"chord":"ctrl+alt+shift+escape"}),
        )
        .await;
    client
        .call(
            3,
            "control.grant",
            json!({"reason":"first","confirmationId":"first"}),
        )
        .await;
    client.send(4, "holdKeys", json!({"target":"desktop","keys":["shift"],"duration":100,"opts":{"deliveryMode":"foreground"}}));
    let events = tokio::task::spawn_blocking(move || loop {
        if matches!(
            events.recv_timeout(Duration::from_secs(5)).unwrap(),
            SinkOp::HeldKey { down: true, .. }
        ) {
            return events;
        }
    })
    .await
    .unwrap();
    client.send(
        5,
        "keyChord",
        json!({"target":"desktop","keys":["ctrl","x"],"opts":{"deliveryMode":"foreground"}}),
    );
    client.call(6, "engine.hello", json!({})).await;
    // when: only the client's transport input ends, as on XPC invalidation.
    drop(client.input);
    let released = tokio::task::spawn_blocking(move || loop {
        match events.recv_timeout(Duration::from_secs(5)) {
            Ok(SinkOp::HeldKey { down: false, .. }) => return true,
            Ok(_) => {}
            Err(_) => return false,
        }
    })
    .await
    .unwrap();
    // then: no duration expiry or a whole-duplex drop can explain the release.
    if !released {
        serving.abort();
    }
    assert!(released, "XPC disconnect did not release held input");
    tokio::time::timeout(Duration::from_secs(5), &mut serving)
        .await
        .unwrap()
        .unwrap();
    assert!(
        !sink
            .ops()
            .iter()
            .any(|op| matches!(op, SinkOp::KeyChord { .. })),
        "queued input ran after disconnect"
    );
    let (mut later, later_serving, _later_sinks) = connection(owner);
    later
        .call(1, "session.open", json!({"allowHostRelayOnlyStop":true}))
        .await;
    later.call(3, "stopPath.heartbeat", json!({})).await;
    let granted = later
        .call(
            2,
            "control.grant",
            json!({"reason":"later","confirmationId":"later"}),
        )
        .await;
    assert_eq!(granted["result"]["reason"], "later", "{granted}");
    drop(later.input);
    tokio::time::timeout(Duration::from_secs(5), later_serving)
        .await
        .unwrap()
        .unwrap();
}
