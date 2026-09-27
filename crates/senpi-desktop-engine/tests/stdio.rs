mod common;

use std::process::Command;

use common::{error_code, fake_backend, Engine, BINARY, DELAYED_CAPTURE, TWO_DISPLAYS};
use serde_json::{json, Value};

#[test]
fn hello_and_capabilities_report_the_abi_and_the_fake_backend_before_session_open() {
    // Given
    let mut engine = Engine::spawn(&[fake_backend(TWO_DISPLAYS)]);
    // When
    let hello = engine.call(1, "engine.hello", json!({}));
    let capabilities = engine.call(2, "capabilities", json!({}));
    // Then
    assert_eq!(hello["result"]["abi"], json!("senpi-desktop/1"));
    assert_eq!(hello["result"]["protocolVersion"], json!("1"));
    assert_eq!(capabilities["result"]["backend"], json!("fake"));
    assert_eq!(capabilities["result"]["displayCount"], json!(2));
    assert!(engine.finish().success());
}

#[test]
fn string_ids_are_echoed_verbatim() {
    let mut engine = Engine::spawn(&[fake_backend(TWO_DISPLAYS)]);
    engine.send(&json!({"jsonrpc": "2.0", "id": "1", "method": "engine.hello", "params": {}}));
    assert_eq!(engine.next()["id"], json!("1"));
}

#[test]
fn an_unconstructible_backend_reports_unavailable_and_exits_zero_at_eof() {
    // Given: the selected scenario cannot be loaded, so no backend exists.
    let mut engine = Engine::spawn(&[fake_backend("does/not/exist.json")]);
    // When
    let capabilities = engine.call(1, "capabilities", json!({}));
    engine.call(2, "session.open", json!({}));
    let capture = engine.call(3, "capture", json!({"target": "desktop"}));
    // Then
    assert_eq!(capabilities["result"]["backend"], json!("unavailable"));
    assert_eq!(error_code(&capture), &json!("CaptureFailed"));
    assert!(engine.finish().success());
}

#[test]
fn pipelined_requests_reach_the_session_in_arrival_order() {
    // Given
    let mut engine = Engine::spawn(&[fake_backend(TWO_DISPLAYS)]);
    // When: capture is sent without waiting for session.open's reply.
    engine.request(1, "session.open", json!({}));
    engine.request(
        2,
        "capture",
        json!({"target": "desktop", "caps": {"maxWidth": 320}}),
    );
    let replies = [engine.next(), engine.next()];
    // Then
    let capture = replies
        .iter()
        .find(|reply| reply["id"] == json!(2))
        .expect("capture replied");
    assert_eq!(capture["result"]["mode"], json!("inline-png"), "{capture}");
    assert_eq!(capture["result"]["sourceWidth"], json!(4800));
}

#[test]
fn requests_after_session_close_fail_closed() {
    let mut engine = Engine::spawn(&[fake_backend(TWO_DISPLAYS)]);
    engine.call(1, "session.open", json!({}));
    assert_eq!(engine.call(2, "session.close", json!({}))["result"], Value::Null);
    let displays = engine.call(3, "displays", json!({}));
    assert_eq!(error_code(&displays), &json!("Closed"));
    assert_eq!(displays["error"]["code"], json!(-32012));
}

#[test]
fn a_capabilities_request_sent_after_a_stuck_capture_is_answered_before_its_timeout() {
    // Given: capture sleeps 5 s in the backend; the deadline is 500 ms.
    let mut engine = Engine::spawn(&[
        fake_backend(DELAYED_CAPTURE),
        ("SENPI_DESKTOP_OPERATION_TIMEOUT_MS", "500".to_owned()),
    ]);
    engine.call(1, "session.open", json!({}));
    // When
    engine.send_all(&[
        json!({"jsonrpc": "2.0", "id": 2, "method": "capture", "params": {"target": "desktop"}}),
        json!({"jsonrpc": "2.0", "id": 3, "method": "capabilities", "params": {}}),
    ]);
    let replies = [engine.next(), engine.next()];
    // Then: reply ORDER proves multiplexing; no latency is asserted.
    assert_eq!(replies[0]["id"], json!(3), "{replies:?}");
    assert_eq!(replies[0]["result"]["backend"], json!("fake"));
    assert_eq!(replies[1]["id"], json!(2));
    assert_eq!(error_code(&replies[1]), &json!("Timeout"));
}

#[test]
fn cancel_answers_the_pending_request_cancelled() {
    // Given: capture is stuck and the deadline is the default minute.
    let mut engine = Engine::spawn(&[fake_backend(DELAYED_CAPTURE)]);
    engine.call(1, "session.open", json!({}));
    engine.request(2, "capture", json!({"target": "desktop"}));
    // When
    engine.send(&json!({"jsonrpc": "2.0", "method": "$/cancel", "params": {"id": 2}}));
    // Then
    let reply = engine.next();
    assert_eq!(reply["id"], json!(2));
    assert_eq!(error_code(&reply), &json!("Cancelled"));
    assert_eq!(reply["error"]["code"], json!(-32017));
}

#[test]
fn unknown_and_test_only_methods_are_method_not_found_with_a_reason() {
    let mut engine = Engine::spawn(&[fake_backend(TWO_DISPLAYS)]);
    let unknown = engine.call(1, "reset", json!({}));
    let test_only = engine.call(2, "$/test.advanceClock", json!({"ms": 1}));
    for (reply, reason) in [(&unknown, "unknown"), (&test_only, "testOnly")] {
        assert_eq!(reply["error"]["code"], json!(-32601));
        assert_eq!(reply["error"]["data"]["reason"], json!(reason));
    }
}

#[test]
fn the_fake_clock_accepts_advance_clock() {
    let mut engine = Engine::spawn(&[
        fake_backend(TWO_DISPLAYS),
        ("SENPI_DESKTOP_FAKE_CLOCK", "1".to_owned()),
    ]);
    let reply = engine.call(1, "$/test.advanceClock", json!({"ms": 2100}));
    assert_eq!(reply["result"], Value::Null, "{reply}");
}

#[test]
fn malformed_lines_answer_parse_and_params_errors() {
    let mut engine = Engine::spawn(&[fake_backend(TWO_DISPLAYS)]);
    engine.send(&json!("not a request"));
    let invalid = engine.next();
    engine.send(&json!({"jsonrpc": "2.0", "id": 2, "method": "capture", "params": {"target": 5}}));
    let bad_params = engine.next();
    assert_eq!(invalid["error"]["code"], json!(-32600));
    assert_eq!(bad_params["error"]["code"], json!(-32602));
}

#[test]
fn schema_prints_the_committed_schema_byte_for_byte() {
    let committed = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../senpi-desktop-core/schema/engine.schema.json"
    ))
    .expect("committed schema is readable");
    let output = Command::new(BINARY)
        .arg("--schema")
        .output()
        .expect("--schema runs");
    assert!(output.status.success());
    assert!(
        output.stdout == committed,
        "--schema drifted from schema/engine.schema.json"
    );
}

#[test]
fn selftest_prints_ok_and_exits_zero() {
    let output = Command::new(BINARY)
        .arg("--selftest")
        .output()
        .expect("--selftest runs");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&output.stdout), "engine: selftest ok\n");
}
