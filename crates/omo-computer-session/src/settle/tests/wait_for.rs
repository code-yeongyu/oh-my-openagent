//! `waitFor({window})` resolves from the observer event, never from a listing.

use omo_computer_core::observation::SettleOutcome;
use omo_computer_core::results::WaitOutcome;
use serde_json::json;

use super::{params, Rig};

#[test]
fn wait_for_window_appeared_uses_zero_listing_calls() {
    let call = json!({
        "target": "101",
        "predicate": {"window": {"state": "appeared", "title": "Save"}},
        "timeout": 1000
    });
    let mut rig = Rig::new(json!({
        "ax_notification_timeline": [{"t_ms": 300, "window": "102", "kind": "AXWindowCreated"}]
    }));
    let result = rig.session.wait_for(params(call.clone())).expect("waitFor");
    assert_eq!(result.outcome, WaitOutcome::Matched);
    assert_eq!(rig.listings(), 0, "no windows() listing in the wait");
    let mut withheld = Rig::new(json!({}));
    let result = withheld.session.wait_for(params(call)).expect("waitFor");
    assert_eq!(result.outcome, WaitOutcome::Timeout);
    assert!(withheld.clock.now_ms() >= 1_000 && withheld.listings() == 0);
}

/// Review M1 (#13370): the call's `timeout` bounds a `waitFor({settle})`, and the busy wait and
/// the quiet window share that one bound.
#[test]
fn wait_for_settle_is_bounded_by_the_call_timeout() {
    // A change every 100 ms never goes quiet: the wait ends at the call's 300 ms.
    let events: Vec<_> = (1..20)
        .map(|i| json!({"t_ms": 100 * i, "window": "101", "kind": "AXValueChanged"}))
        .collect();
    let mut rig = Rig::new(json!({ "ax_notification_timeline": events }));
    let result = rig
        .session
        .wait_for(params(json!({"target": "101", "predicate": {"settle": {}}, "timeout": 300})))
        .expect("waitFor");
    let settle = result.observation.settle.expect("the settle it ran");
    assert_eq!(
        (settle.outcome, settle.waited_ms),
        (SettleOutcome::Pending, 300),
        "never past the call's timeout"
    );
    // Busy until 800 ms, then never quiet: busy and quiet share the regime's 1,000 ms cap.
    let events: Vec<_> = (9..30)
        .map(|i| json!({"t_ms": 100 * i, "window": "101", "kind": "AXValueChanged"}))
        .collect();
    let mut rig = Rig::new(json!({
        "busy_timeline": [
            {"t_ms": 0, "window": "101", "busy": true, "indicator": "spinner"},
            {"t_ms": 800, "window": "101", "busy": false}
        ],
        "ax_notification_timeline": events
    }));
    let result = rig
        .session
        .wait_for(params(json!({"target": "101", "predicate": {"settle": {}}})))
        .expect("waitFor");
    let settle = result.observation.settle.expect("the settle it ran");
    assert_eq!(
        (settle.outcome, settle.waited_ms),
        (SettleOutcome::Pending, 1_000),
        "one cap for the busy wait and the quiet window together"
    );
}
