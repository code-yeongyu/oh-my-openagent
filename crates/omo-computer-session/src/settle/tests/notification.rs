//! `waitFor({notification})`: a named predicate only, a NEW fingerprint only, the body never.

use omo_computer_core::backend::NO_NOTIFICATION_SURFACE;
use omo_computer_core::results::WaitOutcome;
use serde_json::{json, Value};

use super::{params, Rig};
use crate::wait_for::NOTIFICATION_UNNAMED;

fn posts() -> Value {
    json!({"notification_timeline": [
        {"t_ms": 0, "app": "Mail", "title": "Build done", "body": "from yesterday"},
        {"t_ms": 300, "app": "Xcode", "title": "Build done", "body": "secret build log"}
    ]})
}

#[test]
fn wait_for_notification_without_app_or_title_is_refused() {
    let mut rig = Rig::new(posts());
    let call = json!({"target": "101", "predicate": {"notification": {}}, "timeout": 1000});
    let refused = rig
        .session
        .wait_for(params(call))
        .expect_err("refused at the call");
    assert_eq!(refused.refusal, NOTIFICATION_UNNAMED);
    assert_eq!(rig.clock.now_ms(), 0, "nothing waited");
}

#[test]
fn wait_for_notification_matches_only_a_fingerprint_absent_at_the_call() {
    let mut rig = Rig::new(posts());
    let call = json!({
        "target": "101",
        "predicate": {"notification": {"title": "Build done"}},
        "timeout": 1000
    });
    let result = rig.session.wait_for(params(call)).expect("waitFor");
    assert_eq!(result.outcome, WaitOutcome::Matched);
    let found = result
        .notification
        .clone()
        .expect("the matched fingerprint");
    assert_eq!(
        (found.app.as_str(), found.title.as_str(), found.arrived_at),
        ("Xcode", "Build done", 300),
        "Mail's post was present at the call"
    );
    let wire = serde_json::to_string(&result).expect("the result serializes");
    assert!(
        !wire.contains("secret build log"),
        "the body never rides: {wire}"
    );
}

#[test]
fn wait_for_notification_without_a_surface_is_unavailable_with_nothing_waited() {
    let mut rig = Rig::new(json!({
        "ax_notification_timeline": [{"t_ms": 100, "window": "101", "kind": "AXValueChanged"}]
    }));
    let call = json!({"target": "101", "predicate": {"notification": {"app": "Mail"}}});
    let refused = rig.session.wait_for(params(call)).expect_err("no surface");
    assert_eq!(refused.refusal, NO_NOTIFICATION_SURFACE);
    assert_eq!(rig.clock.now_ms(), 0, "nothing waited");
}
