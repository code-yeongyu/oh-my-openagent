use crate::Incoming;
use senpi_desktop_backend_fake::{FakeBackend, FakeScenario, SinkOp};
use senpi_desktop_core::{
    backend::Backend,
    error::{CoreResult, ErrorCode},
    types::DesktopSessionOptions,
};
use senpi_desktop_safety::{FakeClock, StopPathId, Supervisor};
use senpi_desktop_session::{
    BackendFactory, ControlSlot, Op, Session, SessionSafety, SessionTimeouts,
};
use serde_json::{Value, json};
use std::{
    sync::{Arc, Mutex},
    thread::JoinHandle,
    time::Duration,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

struct Factory {
    events: flume::Sender<&'static str>,
    observers: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

impl BackendFactory for Factory {
    fn create(&self, _: &DesktopSessionOptions) -> CoreResult<Box<dyn Backend>> {
        let backend = FakeBackend::new(FakeScenario::default());
        let receiver = backend.sink().subscribe();
        let events = self.events.clone();
        let observer = std::thread::spawn(move || {
            for op in receiver {
                if let SinkOp::HeldKey { down, .. } = op {
                    if events
                        .send(if down { "KEY_DOWN" } else { "KEY_UP" })
                        .is_err()
                    {
                        return;
                    }
                }
            }
        });
        self.observers.lock().unwrap().push(observer);
        Ok(Box::new(backend))
    }
}

pub(super) async fn serve(
    stream: Incoming,
    slot: Arc<ControlSlot>,
    events: flume::Sender<&'static str>,
) {
    let supervisor = Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))));
    supervisor.set_live(StopPathId::HostRelay, true);
    let observers = Arc::new(Mutex::new(Vec::new()));
    let session = Session::start_supervised(
        Factory {
            events,
            observers: Arc::clone(&observers),
        },
        SessionTimeouts {
            operation: Duration::from_secs(120),
            ..SessionTimeouts::default()
        },
        SessionSafety {
            supervisor,
            control_slot: slot,
            audit: Box::new(|_| {}),
        },
    )
    .unwrap();
    let stream = Arc::new(stream);
    // These are the same two duplex splits as engine xpc::serve. In particular,
    // output keeps the other transport half alive when the client is killed.
    let (engine, transport) = tokio::io::duplex(2 * 1024 * 1024);
    let (reader, mut writer) = tokio::io::split(engine);
    let (outgoing, incoming) = tokio::io::split(transport);
    let source = Arc::clone(&stream);
    let input = async move {
        crate::forward_frames(incoming, || source.receive(), |_| true)
            .await
            .unwrap();
        source.close();
    };
    let output = async {
        let mut lines = BufReader::new(outgoing).lines();
        while let Some(line) = lines.next_line().await.unwrap() {
            if stream.send(line.as_bytes()).is_err() {
                break;
            }
        }
    };
    let route = async {
        let mut held = None;
        let mut lines = BufReader::new(reader).lines();
        while let Some(frame) = lines.next_line().await.unwrap() {
            let request: Value = serde_json::from_str(&frame).unwrap();
            let result = match request["method"].as_str().unwrap() {
                "session.open" => {
                    session
                        .open(serde_json::from_value(request["params"].clone()).unwrap())
                        .wait()
                        .await
                }
                "control.grant" => {
                    session
                        .submit(Op::ControlGrant(
                            serde_json::from_value(request["params"].clone()).unwrap(),
                        ))
                        .wait()
                        .await
                }
                "holdKeys" => {
                    held = Some(session.submit(Op::HoldKeys(
                        serde_json::from_value(request["params"].clone()).unwrap(),
                    )));
                    continue;
                }
                other => panic!("unexpected fixture method {other}"),
            }
            .unwrap();
            let reply =
                serde_json::to_vec(&json!({"jsonrpc":"2.0","id":request["id"],"result":result}))
                    .unwrap();
            writer.write_all(&reply).await.unwrap();
            writer.write_all(b"\n").await.unwrap();
        }
        // Actual agent.rs -> Incoming::receive EOF cancels the actual Session waiter.
        drop(held);
        session.close().wait().await.unwrap();
        assert_eq!(
            session
                .submit(Op::ControlState)
                .wait()
                .await
                .unwrap_err()
                .code,
            ErrorCode::Closed
        );
        writer.shutdown().await.unwrap();
        for observer in observers.lock().unwrap().drain(..) {
            observer.join().unwrap();
        }
    };
    tokio::join!(input, output, route);
}
