//! Resource caps (DESIGN 9): an object-mode session idle for 15 minutes on
//! the engine's clock flushes its frames and refs and announces
//! `epoch.changed{idle_flush}`; a null-mode session is never flushed.

mod common;

use common::scenario::{headless, Scenario, CHORD};
use common::Engine;
use serde_json::{json, Value};

const MINUTE_MS: u64 = 60_000;

/// Sends `method` and, once it is answered, `engine.hello`; returns the reply
/// to `method` plus every notification written before the hello's reply,
/// which flushes whatever `method` queued.
fn call_with_notifications(engine: &mut Engine, id: i64, method: &str, params: Value) -> (Value, Vec<Value>) {
    let mut notifications = Vec::new();
    let mut reply_to = |engine: &mut Engine, id: i64, method: &str, params: Value| {
        engine.request(id, method, params);
        loop {
            let message = engine.next();
            match message.get("id") {
                Some(found) if *found == json!(id) => return message,
                Some(_) => panic!("unexpected reply {message}"),
                None => notifications.push(message),
            }
        }
    };
    let reply = reply_to(engine, id, method, params);
    reply_to(engine, id + 1, "engine.hello", json!({}));
    (reply, notifications)
}

fn epoch_changes(notifications: &[Value]) -> Vec<&Value> {
    notifications
        .iter()
        .filter(|message| message["method"] == json!("epoch.changed"))
        .map(|message| &message["params"])
        .collect()
}

fn advance(engine: &mut Engine, minutes: u64) {
    let reply = engine.invoke("$/test.advanceClock", json!({"ms": minutes * MINUTE_MS}));
    assert!(reply.get("error").is_none(), "{reply}");
}

fn focused_ref(engine: &mut Engine) -> String {
    let focused = engine.invoke("ax.focused", json!({}));
    focused["result"]["ref"].as_str().unwrap_or_else(|| panic!("no focused ref in {focused}")).to_owned()
}

fn engine(report_mode: &str) -> (Engine, Scenario) {
    let scenario = Scenario::two_displays_with(&json!({}));
    let mut engine = headless(scenario.backend(), &[]);
    let opened = engine.invoke(
        "session.open",
        json!({"allowHostRelayOnlyStop": true, "showCursor": false, "reportMode": report_mode}),
    );
    assert!(opened.get("error").is_none(), "{opened}");
    engine.invoke("stopPath.start", json!({"chord": CHORD}));
    (engine, scenario)
}

#[test]
fn an_object_session_idle_for_fifteen_minutes_flushes_its_refs_and_announces_idle_flush() {
    // Given
    let (mut engine, _scenario) = engine("object");
    let before = focused_ref(&mut engine);
    // When: 14 minutes pass (control)
    advance(&mut engine, 14);
    let (windows, notifications) = call_with_notifications(&mut engine, 1, "windows", json!({}));
    // Then: nothing is flushed
    assert!(windows.get("error").is_none(), "{windows}");
    assert!(epoch_changes(&notifications).is_empty(), "{notifications:?}");
    let node = engine.invoke("ax.node", json!({"ref": before}));
    assert!(node.get("error").is_none(), "a 14 minute pause expired the ref: {node}");
    // When: 15 minutes pass since that request
    advance(&mut engine, 15);
    let (windows, notifications) = call_with_notifications(&mut engine, 3, "windows", json!({}));
    // Then: one idle_flush move, and the ref taken before it is stale
    assert!(windows.get("error").is_none(), "{windows}");
    assert_eq!(epoch_changes(&notifications), vec![&json!({"reason": "idle_flush"})], "{notifications:?}");
    let node = engine.invoke("ax.node", json!({"ref": before}));
    assert_eq!(common::error_code(&node), &json!("StaleRef"), "{node}");
    // And: the next request is not idle, so nothing more is announced
    let (_, notifications) = call_with_notifications(&mut engine, 5, "windows", json!({}));
    assert!(epoch_changes(&notifications).is_empty(), "{notifications:?}");
    engine.drain();
}

#[test]
fn a_null_mode_session_is_never_idle_flushed() {
    // Given
    let (mut engine, _scenario) = engine("null");
    let before = focused_ref(&mut engine);
    // When
    advance(&mut engine, 60);
    let (windows, notifications) = call_with_notifications(&mut engine, 1, "windows", json!({}));
    // Then
    assert!(windows.get("error").is_none(), "{windows}");
    assert!(epoch_changes(&notifications).is_empty(), "{notifications:?}");
    let node = engine.invoke("ax.node", json!({"ref": before}));
    assert!(node.get("error").is_none(), "a null-mode ref expired: {node}");
    engine.drain();
}
