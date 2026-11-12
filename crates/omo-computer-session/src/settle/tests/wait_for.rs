//! `waitFor({window})` resolves from the observer event, never from a listing.

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
