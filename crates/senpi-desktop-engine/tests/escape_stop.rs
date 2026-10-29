//! Physical Escape through the real session worker and notification outbox.
mod common;

use common::scenario::{headless, make_stop_path_live, Scenario};
use common::{error_code, Engine};
use serde_json::{json, Value};

fn grant(engine: &mut Engine, automatic: bool) {
    let reply = engine.invoke("control.grant", json!({
        "reason": "test consent", "confirmationId": "escape-test", "automatic": automatic
    }));
    assert_eq!(reply["result"]["active"], json!(true), "{reply:?}");
}

fn stopped_input(engine: &mut Engine, delivery: &str, text: &str) {
    engine.request(404, "typeText", json!({
        "target": "101", "text": text, "opts": { "deliveryMode": delivery }
    }));
    let mut reply = None;
    let mut notification = None;
    while reply.is_none() || notification.is_none() {
        let message = engine.next();
        if message["id"] == json!(404) {
            reply = Some(message);
        } else if message["method"] == json!("escape.stopped") {
            notification = Some(message);
        }
    }
    assert_eq!(error_code(&reply.unwrap()), &json!("Cancelled"));
    assert_eq!(notification.unwrap()["params"]["escapeStops"], json!(1));
    let state = engine.invoke("control.state", json!({}));
    assert_eq!(state["result"]["active"], json!(false));
    assert_eq!(state["result"]["escapeStops"], json!(1));
}

#[test]
fn escape_cancels_foreground_typing_even_after_the_final_chunk_and_notifies() {
    for text in ["x", "abcdefghijklmnop"] {
        let scenario = Scenario::two_displays_with(&json!({"escape_on_text": true}));
        let mut engine = headless(scenario.backend(), &[]);
        make_stop_path_live(&mut engine);
        grant(&mut engine, true);
        stopped_input(&mut engine, "foreground", text);
    }
}

#[test]
fn automatic_background_input_ignores_escape_but_explicit_held_control_does_not() {
    let scenario = Scenario::two_displays_with(&json!({"escape_on_text": true}));
    let mut engine = headless(scenario.backend(), &[]);
    make_stop_path_live(&mut engine);
    grant(&mut engine, true);
    let typed = engine.invoke("typeText", json!({"target": "101", "text": "background"}));
    assert_eq!(typed["result"], Value::Null, "{typed:?}");
    let state = engine.invoke("control.state", json!({}));
    assert_eq!(state["result"]["escapeStops"], json!(0));
    assert_eq!(state["result"]["active"], json!(true));
    grant(&mut engine, false);
    stopped_input(&mut engine, "background", "held");
}

#[test]
fn unavailable_escape_watch_refuses_takeover_and_manual_grant() {
    let scenario = Scenario::two_displays_with(&json!({"escape_watch_off": true}));
    let mut engine = headless(scenario.backend(), &[]);
    make_stop_path_live(&mut engine);
    grant(&mut engine, true);
    let refused = engine.invoke("typeText", json!({
        "target": "101", "text": "must not type", "opts": {"deliveryMode": "foreground"}
    }));
    assert_eq!(error_code(&refused), &json!("StopPathUnavailable"));
    let refused_grant = engine.invoke("control.grant", json!({
        "reason": "held", "confirmationId": "manual", "automatic": false
    }));
    assert_eq!(error_code(&refused_grant), &json!("StopPathUnavailable"));
    let state = engine.invoke("control.state", json!({}));
    assert_eq!(state["result"]["active"], json!(false));
    assert_eq!(state["result"]["escapeStops"], json!(0));
}
