//! The control grant over the wire: `control.state` is public, grant and
//! revoke are host-only, a suspension revokes, and resume never restores.

mod common;

use common::scenario::{capture, headless, make_stop_path_live, Scenario};
use common::{error_code, Engine};
use serde_json::{json, Value};

const WINDOW: &str = "101";

fn grant(engine: &mut Engine, reason: &str) -> Value {
    engine.invoke(
        "control.grant",
        json!({"reason": reason, "confirmationId": "confirm-1"}),
    )
}

fn state(engine: &mut Engine) -> Value {
    engine.invoke("control.state", json!({}))
}

fn foreground_click(engine: &mut Engine) -> Value {
    let opts = json!({"deliveryMode": "foreground"});
    engine.invoke("click", json!({"target": WINDOW, "x": 10.0, "y": 10.0, "opts": opts}))
}

#[test]
fn foreground_control_flows_over_the_wire() {
    // Given: an opened session with a live stop path and a captured window.
    let scenario = Scenario::two_displays_with(&json!({}));
    let mut engine = headless(scenario.backend(), &[]);
    let token = make_stop_path_live(&mut engine);
    capture(&mut engine, WINDOW);
    // Then: state starts inactive
    assert_eq!(state(&mut engine)["result"]["active"], json!(false));
    // When: foreground without a grant
    let refused = foreground_click(&mut engine);
    assert_eq!(error_code(&refused), &json!("ControlRequired"));
    // When: granted
    let granted = grant(&mut engine, "with the human watching");
    assert_eq!(granted["result"]["active"], json!(true));
    assert_eq!(granted["result"]["reason"], json!("with the human watching"));
    assert_eq!(state(&mut engine)["result"]["active"], json!(true));
    // Then: foreground is admitted
    assert_eq!(foreground_click(&mut engine)["result"], json!(null));
    // When: revoked (twice, idempotent)
    assert_eq!(engine.invoke("control.revoke", json!({}))["result"], json!(null));
    assert_eq!(engine.invoke("control.revoke", json!({}))["result"], json!(null));
    assert_eq!(state(&mut engine)["result"]["active"], json!(false));
    // Then: foreground is refused again
    assert_eq!(error_code(&foreground_click(&mut engine)), &json!("ControlRequired"));
    // When: re-granted, then suspended and resumed
    grant(&mut engine, "again");
    engine.invoke("stopPath.stop", json!({"source": "api"}));
    engine.invoke("stopPath.resume", json!({"token": token}));
    // Then: the grant did not survive the stop
    assert_eq!(state(&mut engine)["result"]["active"], json!(false));
    assert_eq!(error_code(&foreground_click(&mut engine)), &json!("ControlRequired"));
}

#[test]
fn grant_and_revoke_are_audited_without_the_raw_reason() {
    // Given
    let scenario = Scenario::two_displays_with(&json!({}));
    let mut engine = headless(scenario.backend(), &[]);
    make_stop_path_live(&mut engine);
    // When: both requests are sent raw, so no reply wait skips an audit
    // notification that precedes it; drain then returns every line in order
    engine.request(
        10,
        "control.grant",
        json!({"reason": "a reason the audit must not quote", "confirmationId": "confirm-1"}),
    );
    engine.request(11, "control.revoke", json!({}));
    let messages = engine.drain();
    // Then: both requests answered; one audit each; the reason only as a digest
    let replies: Vec<&Value> = messages.iter().filter(|message| message.get("id").is_some()).collect();
    assert_eq!(replies.len(), 2, "{messages:?}");
    assert!(replies.iter().all(|reply| reply.get("error").is_none()), "{replies:?}");
    let audits: Vec<Value> = messages
        .iter()
        .filter(|message| message["method"] == json!("audit"))
        .cloned()
        .collect();
    let actions: Vec<&str> = audits
        .iter()
        .filter_map(|audit| audit["params"]["action"].as_str())
        .collect();
    assert_eq!(actions, ["control.grant", "control.revoke"]);
    let serialized = serde_json::to_string(&audits).expect("audits serialize");
    assert!(
        !serialized.contains("a reason the audit must not quote"),
        "{serialized}"
    );
}
