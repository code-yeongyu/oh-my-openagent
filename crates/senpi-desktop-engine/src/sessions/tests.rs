//! Binary-local tests keep the session owner private.
use crate::{config::EngineConfig, sessions::Sessions};
use senpi_desktop_backend_fake::FakeScenario;
use senpi_desktop_session::{BackendSelection, SessionTimeouts};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};

fn config() -> EngineConfig {
    EngineConfig {
        selection: BackendSelection::FakeScenario(Box::default()),
        timeouts: SessionTimeouts::default(),
        fake_clock: true,
    }
}

struct Client {
    io: BufReader<DuplexStream>,
    task: tokio::task::JoinHandle<()>,
}

impl Client {
    fn new(owner: &Sessions) -> Self {
        let engine = owner.open(config()).unwrap();
        Self::with_engine(engine)
    }

    fn with_engine(engine: Arc<crate::engine::Engine>) -> Self {
        let (client, server) = tokio::io::duplex(64 * 1024);
        let (reader, writer) = tokio::io::split(server);
        let task = tokio::spawn(async move {
            crate::connection::serve_session_connection(Arc::clone(&engine), reader, writer)
                .await
                .unwrap();
            engine.shutdown().await;
        });
        Self {
            io: BufReader::new(client),
            task,
        }
    }

    async fn send(&mut self, id: i64, method: &str, params: Value) {
        let mut text = json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string();
        text.push('\n');
        self.io.get_mut().write_all(text.as_bytes()).await.unwrap();
    }

    async fn next(&mut self) -> Value {
        let mut line = String::new();
        let read = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            self.io.read_line(&mut line),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(read > 0, "connection closed before reply");
        serde_json::from_str(&line).unwrap()
    }

    async fn call(&mut self, id: i64, method: &str, params: Value) -> Value {
        self.send(id, method, params).await;
        loop {
            let value = self.next().await;
            if value["id"] == id {
                return value;
            }
        }
    }

    async fn close(self) {
        drop(self.io);
        tokio::time::timeout(std::time::Duration::from_secs(5), self.task)
            .await
            .unwrap()
            .unwrap();
    }
}

#[tokio::test]
async fn two_clients_with_identical_ids_have_private_replies_and_audits() {
    // given
    let owner = Sessions::new();
    let mut a = Client::new(&owner);
    let mut b = Client::new(&owner);
    a.call(1, "session.open", json!({})).await;
    b.call(1, "session.open", json!({})).await;
    // when
    a.send(
        2,
        "control.grant",
        json!({"reason":"owner-a","confirmationId":"a"}),
    )
    .await;
    b.send(2, "control.state", json!({})).await;
    let reply_a = a.next().await;
    let audit_a = a.next().await;
    let reply_b = b.next().await;
    // then
    assert_eq!(reply_a["result"]["reason"], "owner-a");
    assert_eq!(audit_a["method"], "audit");
    assert_eq!(reply_b["result"]["active"], false);
    a.close().await;
    b.close().await;
}

#[tokio::test]
async fn session_close_does_not_close_another_clients_session() {
    // given
    let owner = Sessions::new();
    let mut a = Client::new(&owner);
    let mut b = Client::new(&owner);
    a.call(1, "session.open", json!({})).await;
    b.call(1, "session.open", json!({})).await;
    // when
    a.call(2, "session.close", json!({})).await;
    let reply = b.call(2, "displays", json!({})).await;
    // then
    assert!(reply.get("result").is_some(), "{reply}");
    a.close().await;
    b.close().await;
}

#[tokio::test]
async fn global_stop_latches_all_clients() {
    #[cfg(target_os = "macos")]
    if crate::xpc_test_harness::run_if_requested().await {
        return;
    }
    // given
    let owner = Sessions::new();
    let mut a = Client::new(&owner);
    let mut b = Client::new(&owner);
    // when
    a.call(1, "stopPath.stop", json!({"source":"api"})).await;
    let reply = b.call(1, "stopPath.status", json!({})).await;
    // then
    assert_eq!(reply["result"]["suspended"], true);
    a.close().await;
    b.close().await;
}

#[tokio::test]
async fn unknown_method_is_refused_without_starting_backend() {
    // given
    let owner = Sessions::new();
    // when
    let result = owner.classify(br#"{"jsonrpc":"2.0","id":1,"method":"arbitrary.exec"}"#);
    // then
    assert!(result.is_err());
    assert_eq!(owner.started_count(), 0);
}

#[tokio::test]
async fn cancel_only_affects_the_owning_connection() {
    // given
    let owner = Sessions::new();
    let engine = owner.open(config()).unwrap();
    let permit = engine
        .permits(senpi_desktop_core::methods::Effect::Read)
        .acquire_many_owned(4)
        .await
        .unwrap();
    let mut a = Client::with_engine(engine);
    let mut b = Client::new(&owner);
    a.call(1, "session.open", json!({})).await;
    a.send(9, "displays", json!({})).await;
    // The hello reply is a same-reader barrier after request 9 was registered.
    a.call(10, "engine.hello", json!({})).await;
    // when
    b.call(2, "$/cancel", json!({"id":9})).await;
    drop(permit);
    let reply = a.next().await;
    // then
    assert_eq!(reply["id"], 9);
    assert!(reply.get("result").is_some(), "{reply}");
    a.close().await;
    b.close().await;
}

#[path = "holds.rs"]
mod holds;

#[path = "release_order.rs"]
mod release_order;

#[tokio::test]
async fn r3_pending_stop_refuses_input_without_wire_publication() {
    use crate::{route::Route, rpc::Failure};
    use senpi_desktop_core::{error::ErrorCode, methods::Method};
    // given: the callback has latched refusal, but commit has not run.
    let owner = Sessions::new();
    let engine = owner.open(config()).unwrap();
    engine.stop_paths().supervisor().suspend_input();
    // when: admission must not enqueue behind a stuck foreground preparation.
    let routed = engine.route(Method::ControlGrant, json!({
        "reason":"pending stop", "confirmationId":"fixture",
    }));
    let published = engine.stop_paths().status().suspended;
    let changed = engine.stop_paths().transition();
    engine.shutdown().await;
    // then: refusal is immediate, but status/notifications are still uncommitted.
    assert!(matches!(routed, Route::Immediate(Err(Failure::Engine(ref error))) if error.code == ErrorCode::Suspended),
        "pending stop enqueued new input: {routed:?}");
    assert!(!published);
    assert!(changed.is_none());
}

#[tokio::test]
async fn r2_l1_session_policy_is_private() {
    // given
    let owner = Sessions::new();
    let a = owner.open(config()).unwrap();
    let b = owner.open(config()).unwrap();
    // when
    a.route(senpi_desktop_core::methods::Method::SessionOpen, json!({"allowHostRelayOnlyStop":true}));
    b.route(senpi_desktop_core::methods::Method::SessionOpen, json!({}));
    a.stop_paths().supervisor().set_live(senpi_desktop_safety::StopPathId::HostRelay, true);
    // then
    assert!(a.stop_paths().status().reason.is_none());
    assert!(b.stop_paths().status().reason.is_some());
    a.shutdown().await;
    b.shutdown().await;
}

#[tokio::test]
async fn r2_l1_every_session_observes_the_stop_transition() {
    // given
    let owner = Sessions::new();
    let a = owner.open(config()).unwrap();
    let b = owner.open(config()).unwrap();
    // when
    a.stop_paths().stop(senpi_desktop_core::protocol_params::StopRequestSource::Api);
    a.announce_stop_path();
    b.announce_stop_path();
    // then
    assert_eq!(a.outbox().drain().len(), 1);
    assert_eq!(b.outbox().drain().len(), 1, "the first session consumed another session's transition");
    a.shutdown().await;
    b.shutdown().await;
}
