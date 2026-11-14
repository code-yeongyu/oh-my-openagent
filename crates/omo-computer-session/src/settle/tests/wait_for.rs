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
        .wait_for(params(
            json!({"target": "101", "predicate": {"settle": {}}, "timeout": 300}),
        ))
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
        .wait_for(params(
            json!({"target": "101", "predicate": {"settle": {}}}),
        ))
        .expect("waitFor");
    let settle = result.observation.settle.expect("the settle it ran");
    assert_eq!(
        (settle.outcome, settle.waited_ms),
        (SettleOutcome::Pending, 1_000),
        "one cap for the busy wait and the quiet window together"
    );
}

/// Review L1 (#13370): a window-gone wait matches only its tracked window, and an event wait
/// only events on its target window; an unrelated destroyed element matches neither.
#[test]
fn window_gone_and_event_waits_ignore_an_unrelated_destroyed_element() {
    let gone = json!({
        "target": "101",
        "predicate": {"window": {"state": "gone", "title": "Save"}},
        "timeout": 1000
    });
    let property =
        json!({"target": "101", "predicate": {"event": {"kind": "property"}}, "timeout": 1000});
    let unrelated = json!({"ax_notification_timeline": [
        {"t_ms": 100, "window": "101", "kind": "AXUIElementDestroyed"},
        {"t_ms": 200, "window": "102", "kind": "AXValueChanged"}
    ]});
    let mut rig = Rig::new(unrelated.clone());
    let result = rig.session.wait_for(params(gone.clone())).expect("waitFor");
    assert_eq!(
        result.outcome,
        WaitOutcome::Timeout,
        "an element of 101 is not the Save window"
    );
    let mut rig = Rig::new(unrelated);
    let result = rig
        .session
        .wait_for(params(property.clone()))
        .expect("waitFor");
    assert_eq!(
        result.outcome,
        WaitOutcome::Timeout,
        "the change was on 102, not 101"
    );
    let related = json!({"ax_notification_timeline": [
        {"t_ms": 100, "window": "101", "kind": "AXUIElementDestroyed"},
        {"t_ms": 200, "window": "101", "kind": "AXValueChanged"},
        {"t_ms": 300, "window": "102", "kind": "AXUIElementDestroyed"}
    ]});
    let mut rig = Rig::new(related.clone());
    let result = rig.session.wait_for(params(gone)).expect("waitFor");
    assert_eq!(result.outcome, WaitOutcome::Matched);
    // The tree read after the wait costs fake time, so the clock is read as a range.
    assert!(
        (300..1_000).contains(&rig.clock.now_ms()),
        "matched on the Save window's close at 300 ms, not before: {}",
        rig.clock.now_ms()
    );
    let mut rig = Rig::new(related);
    let result = rig.session.wait_for(params(property)).expect("waitFor");
    assert_eq!(result.outcome, WaitOutcome::Matched);
    assert!(
        (200..300).contains(&rig.clock.now_ms()),
        "matched on the change of 101 at 200 ms: {}",
        rig.clock.now_ms()
    );
}

/// Review L2 of #13370 (at c72fac7d86): a gone wait that names its window by title cannot know
/// which windows it tracks when the listing fails; it answers the listing's refusal instead of
/// waiting the whole timeout for nothing.
#[test]
fn a_gone_wait_whose_listing_fails_refuses_instead_of_timing_out() {
    let mut rig = Rig::new(json!({
        "fail_next": [{"method": "windows", "code": "Internal"}]
    }));
    let refused = rig
        .session
        .wait_for(params(json!({
            "target": "101",
            "predicate": {"window": {"state": "gone", "title": "Save"}},
            "timeout": 1000
        })))
        .expect_err("the failed listing is answered, not waited out");
    assert_eq!(
        refused.refusal.code,
        omo_computer_core::error::EngineCode::Internal
    );
    assert!(
        rig.clock.now_ms() < 1_000,
        "no wait ran: {}",
        rig.clock.now_ms()
    );
}
