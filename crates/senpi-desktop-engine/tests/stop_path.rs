//! The stop-path ladder over stdio against the fake backend: nothing is armed
//! by `session.open`, the host relay authorizes input only under
//! `allowHostRelayOnlyStop` and only while its heartbeat is fresh, a stop
//! latches until `stopPath.resume` with the token of the `session.open` reply.

mod common;

use common::{error_code, fake_backend, Engine, TWO_DISPLAYS};
use serde_json::{json, Value};

const CHORD: &str = "ctrl+alt+shift+escape";

fn engine() -> Engine {
    Engine::spawn(&[
        fake_backend(TWO_DISPLAYS),
        ("SENPI_DESKTOP_FAKE_CLOCK", "1".to_owned()),
    ])
}

/// Opens a session and returns its resume token.
fn open(engine: &mut Engine, allow_host_relay_only_stop: bool) -> String {
    let opened = engine.call(
        1,
        "session.open",
        json!({"allowHostRelayOnlyStop": allow_host_relay_only_stop}),
    );
    opened["result"]["resumeToken"]
        .as_str()
        .expect("session.open returns a resume token")
        .to_owned()
}

/// `stopPath.start` + one heartbeat + a capture to click on, as the host
/// does after activation. Returns the resume token.
fn live_session(engine: &mut Engine) -> String {
    let token = open(engine, true);
    engine.call(2, "stopPath.start", json!({"chord": CHORD}));
    engine.call(3, "stopPath.heartbeat", json!({}));
    engine.call(4, "capture", json!({"target": "desktop"}));
    token
}

fn click(engine: &mut Engine, id: i64) -> Value {
    engine.call(id, "click", json!({"target": "desktop", "x": 10.0, "y": 10.0}))
}

fn stop_path_unavailable(reply: &Value) -> (&Value, &Value) {
    (error_code(reply), &reply["error"]["message"])
}

#[test]
fn session_open_arms_no_stop_path_so_input_is_refused() {
    // Given
    let mut engine = engine();
    open(&mut engine, false);
    // When
    let refused = click(&mut engine, 10);
    // Then
    assert_eq!(
        stop_path_unavailable(&refused),
        (&json!("StopPathUnavailable"), &json!("no-global-listener"))
    );
    let status = engine.call(11, "stopPath.status", json!({}));
    assert_eq!(status["result"]["hostRelayLive"], json!(false));
    assert_eq!(status["result"]["stopPath"], json!("none"));
}

#[test]
fn a_host_relay_alone_never_enables_input_without_the_policy() {
    // Given
    let mut engine = engine();
    open(&mut engine, false);
    // When: the host arms the relay on a host without a Global listener
    let started = engine.call(2, "stopPath.start", json!({"chord": CHORD}));
    engine.call(3, "stopPath.heartbeat", json!({}));
    engine.call(4, "capture", json!({"target": "desktop"}));
    let refused = click(&mut engine, 5);
    // Then
    let status = &started["result"];
    assert_eq!(
        [
            &status["globalLive"],
            &status["hostRelayLive"],
            &status["stopPath"]
        ],
        [&json!(false), &json!(true), &json!("host-relay")]
    );
    assert_eq!(
        stop_path_unavailable(&refused),
        (&json!("StopPathUnavailable"), &json!("host-relay-not-allowed"))
    );
}

#[test]
fn a_fresh_host_relay_enables_input_under_the_policy() {
    let mut engine = engine();
    live_session(&mut engine);
    let clicked = click(&mut engine, 10);
    assert_eq!(clicked["result"], Value::Null, "{clicked}");
}

#[test]
fn a_silent_host_disables_input_after_the_freshness_window() {
    // Given
    let mut engine = engine();
    live_session(&mut engine);
    // When: 2.1 s pass without a heartbeat
    engine.call(10, "$/test.advanceClock", json!({"ms": 2100}));
    let refused = click(&mut engine, 11);
    // Then
    assert_eq!(
        stop_path_unavailable(&refused),
        (&json!("StopPathUnavailable"), &json!("heartbeat-stale"))
    );
}

#[test]
fn a_host_relay_stop_suspends_input_and_announces_the_transition() {
    // Given
    let mut engine = engine();
    live_session(&mut engine);
    // When
    let stopped = engine.call(10, "stopPath.stop", json!({"source": "host-relay"}));
    // Then: the reply and the notification that follows it report the latch
    assert_eq!(stopped["result"]["suspended"], json!(true));
    let changed = engine.next();
    assert_eq!(changed["method"], json!("stopPath.changed"), "{changed}");
    assert_eq!(changed["params"]["suspended"], json!(true));
    assert_eq!(error_code(&click(&mut engine, 11)), &json!("Suspended"));
}

#[test]
fn resume_rejects_a_wrong_token_and_accepts_the_session_open_token() {
    // Given: a suspended session
    let mut engine = engine();
    let token = live_session(&mut engine);
    engine.call(10, "stopPath.stop", json!({"source": "api"}));
    // When
    let wrong = engine.call(11, "stopPath.resume", json!({"token": "wrong"}));
    let still_suspended = error_code(&click(&mut engine, 12)).clone();
    let resumed = engine.call(14, "stopPath.resume", json!({"token": token}));
    // Then
    assert_eq!(error_code(&wrong), &json!("PermissionDenied"));
    assert_eq!(still_suspended, json!("Suspended"));
    assert_eq!(resumed["result"]["suspended"], json!(false), "{resumed}");
    assert_eq!(click(&mut engine, 15)["result"], Value::Null);
}

#[test]
fn the_token_of_another_engine_process_cannot_resume() {
    // Given: a model spawns its own engine and learns that engine's token
    let mut host = engine();
    live_session(&mut host);
    host.call(10, "stopPath.stop", json!({"source": "host-relay"}));
    let mut spawned_by_model = engine();
    let foreign_token = open(&mut spawned_by_model, true);
    // When
    let resumed = host.call(11, "stopPath.resume", json!({"token": foreign_token}));
    // Then
    assert_eq!(error_code(&resumed), &json!("PermissionDenied"));
}

#[test]
fn capabilities_report_the_stop_path_and_why_it_is_not_global() {
    // Given
    let mut engine = engine();
    let before = engine.call(1, "capabilities", json!({}));
    // When
    engine.call(2, "stopPath.start", json!({"chord": CHORD}));
    let after = engine.call(3, "capabilities", json!({}));
    // Then
    let stop = |reply: &Value| {
        (
            reply["result"]["stopPath"].clone(),
            reply["result"]["stopReason"].clone(),
        )
    };
    assert_eq!(stop(&before), (json!("none"), json!("no-global-listener")));
    assert_eq!(stop(&after), (json!("host-relay"), json!("no-global-listener")));
}

#[test]
fn an_empty_chord_key_is_invalid_params_and_arms_nothing() {
    let mut engine = engine();
    let rejected = engine.call(1, "stopPath.start", json!({"chord": "ctrl++escape"}));
    let status = engine.call(2, "stopPath.status", json!({}));
    assert_eq!(rejected["error"]["code"], json!(-32602));
    assert_eq!(status["result"]["hostRelayLive"], json!(false));
}
