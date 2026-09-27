//! The built engine binary driven headless over stdio against the fake
//! backend: frames, AX ref generations, timeouts, cancel, close, the stop
//! path, and notifications. Every input-path case first makes the host-relay
//! stop path live exactly as the host does. Waits are bounded by the 30 s
//! hang guard only; no assertion depends on latency.

mod common;
#[path = "headless/error_codes.rs"]
mod error_codes;

use common::scenario::{capture, headless, make_stop_path_live, snapshot_ref, Scenario};
use common::{error_code, fake_backend, Engine, TWO_DISPLAYS};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// Base64 of the 8-byte PNG signature.
const PNG_BASE64_PREFIX: &str = "iVBORw0KGgo";
/// The fake scenario's only window.
const WINDOW: &str = "101";

fn two_displays() -> Engine {
    headless(fake_backend(TWO_DISPLAYS), &[])
}

fn click(engine: &mut Engine, target: &str, frame_id: Option<&str>) -> Value {
    let mut params = json!({"target": target, "x": 10.0, "y": 10.0});
    if let Some(frame_id) = frame_id {
        params["frameId"] = json!(frame_id);
    }
    engine.invoke("click", params)
}

/// Reads until `found` matches, returning every message in arrival order.
fn read_until(engine: &Engine, found: impl Fn(&Value) -> bool) -> Vec<Value> {
    let mut seen = vec![engine.next()];
    while !seen.last().is_some_and(&found) {
        seen.push(engine.next());
    }
    seen
}

#[test]
fn capture_reports_the_source_size_and_an_inline_base64_png() {
    // Given
    let mut engine = two_displays();
    engine.invoke("session.open", json!({}));
    // When
    let captured = engine.invoke("capture", json!({"target": "desktop", "caps": {"maxWidth": 320}}));
    // Then: the composite of both displays' pixels, downscaled to the cap
    let result = &captured["result"];
    assert_eq!(
        (&result["sourceWidth"], &result["sourceHeight"]),
        (&json!(4800), &json!(1800))
    );
    assert_eq!(result["width"], json!(320), "{captured}");
    let data = result["data"].as_str().expect("inline capture carries data");
    assert!(
        data.starts_with(PNG_BASE64_PREFIX),
        "not a base64 PNG: {data:.32}"
    );
}

#[test]
fn a_click_with_the_frame_of_another_target_is_invalid_coordinate_frame() {
    // Given: both the desktop and the window have a latest frame
    let mut engine = two_displays();
    make_stop_path_live(&mut engine);
    let desktop_frame = capture(&mut engine, "desktop");
    let window_frame = capture(&mut engine, WINDOW);
    // When
    let refused = click(&mut engine, WINDOW, Some(&desktop_frame));
    // Then
    assert_eq!(
        error_code(&refused),
        &json!("InvalidCoordinateFrame"),
        "{refused}"
    );
    let accepted = click(&mut engine, WINDOW, Some(&window_frame));
    assert_eq!(
        accepted["result"],
        Value::Null,
        "the window's own frame is accepted: {accepted}"
    );
}

#[test]
fn a_window_resized_since_its_capture_is_invalid_coordinate_frame_with_a_recapture_hint() {
    // Given: the scenario resizes the window right after its next capture
    let scenario = Scenario::two_displays_with(&json!({
        "resize_window": {"id": WINDOW, "width": 400, "height": 300}
    }));
    let mut engine = headless(scenario.backend(), &[]);
    make_stop_path_live(&mut engine);
    capture(&mut engine, WINDOW);
    // When
    let refused = click(&mut engine, WINDOW, None);
    // Then
    assert_eq!(
        error_code(&refused),
        &json!("InvalidCoordinateFrame"),
        "{refused}"
    );
    let message = refused["error"]["message"].as_str().unwrap_or_default();
    assert!(message.contains("capture it again"), "{message}");
}

#[test]
fn an_ax_ref_older_than_the_previous_snapshot_is_stale_ref() {
    // Given: the Save button's ref from a snapshot, then two newer snapshots
    let mut engine = two_displays();
    make_stop_path_live(&mut engine);
    let save = snapshot_ref(&mut engine, WINDOW, "\"Save\"");
    engine.invoke("ax.snapshot", json!({"target": WINDOW}));
    engine.invoke("ax.snapshot", json!({"target": WINDOW}));
    // When
    let performed = engine.invoke("ax.perform", json!({"ref": save, "action": "press"}));
    // Then
    assert_eq!(error_code(&performed), &json!("StaleRef"), "{performed}");
}

#[test]
fn session_close_is_idempotent_and_later_requests_fail_closed() {
    // Given
    let mut engine = two_displays();
    engine.invoke("session.open", json!({}));
    // When
    let first = engine.invoke("session.close", json!({}));
    let second = engine.invoke("session.close", json!({}));
    // Then
    assert_eq!(
        (&first["result"], &second["result"]),
        (&Value::Null, &Value::Null),
        "{second}"
    );
    assert_eq!(error_code(&engine.invoke("windows", json!({}))), &json!("Closed"));
    assert!(engine.finish().success());
}

#[test]
fn a_timed_out_input_is_answered_before_the_backend_completes_it() {
    // Given: typing sleeps 5 s in the backend; the operation deadline is 500 ms
    // and the close deadline outlasts the sleep, so close waits for it.
    let scenario = Scenario::two_displays_with(&json!({"delay_ms": {"type_text": 5000}}));
    let mut engine = headless(
        scenario.backend(),
        &[
            ("SENPI_DESKTOP_OPERATION_TIMEOUT_MS", "500"),
            ("SENPI_DESKTOP_CLOSE_TIMEOUT_MS", "20000"),
        ],
    );
    make_stop_path_live(&mut engine);
    // When
    engine.request(10, "typeText", json!({"target": WINDOW, "text": "hi"}));
    let timed_out = engine.next();
    engine.request(11, "session.close", json!({}));
    let seen = read_until(&engine, |message| message["method"] == json!("audit"));
    // Then: the backend's completion (its audit) arrives only after the Timeout reply
    assert_eq!(timed_out["id"], json!(10), "{timed_out}");
    assert_eq!(error_code(&timed_out), &json!("Timeout"));
    let audit = seen.last().expect("read_until returns the audit");
    assert_eq!(audit["params"]["action"], json!("typeText"), "{seen:?}");
}

#[test]
fn cancel_answers_a_pending_input_cancelled() {
    // Given: typing is stuck in the backend under the default deadline
    let scenario = Scenario::two_displays_with(&json!({"delay_ms": {"type_text": 5000}}));
    let mut engine = headless(scenario.backend(), &[]);
    make_stop_path_live(&mut engine);
    engine.request(10, "typeText", json!({"target": WINDOW, "text": "hi"}));
    // When
    engine.send(&json!({"jsonrpc": "2.0", "method": "$/cancel", "params": {"id": 10}}));
    // Then
    let reply = engine.next();
    assert_eq!(reply["id"], json!(10), "{reply}");
    assert_eq!(error_code(&reply), &json!("Cancelled"));
}

#[test]
fn one_mutating_call_emits_an_audit_carrying_every_audit_field() {
    // Given
    let mut engine = two_displays();
    make_stop_path_live(&mut engine);
    // When
    engine.request(10, "typeText", json!({"target": WINDOW, "text": "hi"}));
    let seen = read_until(&engine, |message| message["method"] == json!("audit"));
    // Then
    let audit = &seen.last().expect("read_until returns the audit")["params"];
    let fields = [
        "action",
        "target",
        "delivery",
        "frameId",
        "code",
        "durationMs",
        "focusRestored",
        "textLength",
        "textSha256",
        "keys",
    ];
    let missing: Vec<&str> = fields
        .into_iter()
        .filter(|field| audit.get(field).is_none())
        .collect();
    assert!(missing.is_empty(), "audit lacks {missing:?}: {audit}");
    let digest: String = Sha256::digest(b"hi")
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(
        [
            &audit["action"],
            &audit["target"],
            &audit["code"],
            &audit["textLength"],
            &audit["textSha256"]
        ],
        [
            &json!("typeText"),
            &json!(WINDOW),
            &Value::Null,
            &json!(2),
            &json!(&digest[..16])
        ]
    );
}

#[test]
fn without_a_backend_capture_fails_and_every_input_stops_at_the_stop_path() {
    // Given: the selected scenario does not exist, so no backend is constructed
    let mut engine = headless(fake_backend("does/not/exist.json"), &[]);
    let capabilities = engine.invoke("capabilities", json!({}));
    engine.invoke("session.open", json!({}));
    // When
    let captured = engine.invoke("capture", json!({"target": "desktop"}));
    let inputs = error_codes::input_calls().map(|(method, params)| (method, engine.invoke(method, params)));
    // Then: the gate refuses before any backend call
    assert_eq!(capabilities["result"]["backend"], json!("unavailable"));
    assert_eq!(error_code(&captured), &json!("CaptureFailed"));
    for (method, reply) in inputs {
        assert_eq!(
            error_code(&reply),
            &json!("StopPathUnavailable"),
            "{method}: {reply}"
        );
    }
    assert!(engine.finish().success());
}
