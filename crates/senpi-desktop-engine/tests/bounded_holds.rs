//! Real stdio routing, gating, and audit coverage for the two exec methods.

mod common;

use common::{fake_backend, Engine, TWO_DISPLAYS};
use serde_json::{json, Value};

fn open() -> Engine {
    let mut engine = Engine::spawn(&[
        fake_backend(TWO_DISPLAYS),
        ("SENPI_DESKTOP_FAKE_CLOCK", "1".to_owned()),
    ]);
    assert!(engine.call(1, "session.open", json!({"allowHostRelayOnlyStop": true}))
        .get("result").is_some());
    engine.call(2, "stopPath.start", json!({"chord": "ctrl+alt+shift+escape"}));
    engine.call(3, "stopPath.heartbeat", json!({}));
    engine
}

fn audited_call(engine: &mut Engine, id: i64, method: &str, params: Value) -> (Value, Value) {
    engine.request(id, method, params);
    let mut audit = None;
    let mut reply = None;
    while audit.is_none() || reply.is_none() {
        let message = engine.next();
        if message["method"] == "audit" && message["params"]["action"] == method {
            audit = Some(message["params"].clone());
        } else if message["id"] == id {
            reply = Some(message);
        }
    }
    (reply.unwrap(), audit.unwrap())
}

#[test]
fn bounded_holds_are_exec_requests_with_one_audit_and_unit_results() {
    // Given the real engine with a permitted live host-relay stop path.
    let mut engine = open();
    engine.call(4, "capture", json!({"target": "101", "caps": {"maxWidth": 64, "maxHeight": 64}}));
    // When each bounded method executes a zero-duration hold.
    let (keys, keys_audit) = audited_call(&mut engine, 5, "holdKeys",
        json!({"target": "101", "keys": ["shift", "a"], "duration": 0}));
    let (mouse, mouse_audit) = audited_call(&mut engine, 6, "holdMouse",
        json!({"target": "101", "x": 10, "y": 10, "duration": 0, "keys": ["ctrl"]}));
    // Then routing preserves each method's audit identity and input options.
    assert_eq!(keys["result"], Value::Null);
    assert!(keys.get("error").is_none(), "{keys}");
    assert_eq!(keys_audit["keys"], json!(["shift", "a"]));
    assert_eq!(mouse["result"], Value::Null);
    assert!(mouse.get("error").is_none(), "{mouse}");
    assert_eq!(mouse_audit["keys"], json!(["ctrl"]));
    assert_eq!(keys_audit["code"], Value::Null);
    assert_eq!(mouse_audit["code"], Value::Null);
}

#[test]
fn invalid_bounded_duration_is_refused_and_audited_over_stdio() {
    let mut engine = open();
    let (reply, audit) = audited_call(&mut engine, 4, "holdKeys",
        json!({"target": "101", "keys": ["a"], "duration": 100.1}));
    assert_eq!(reply["error"]["data"]["code"], "InputFailed");
    assert_eq!(audit["code"], "InputFailed");
}
