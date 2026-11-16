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
        {"t_ms": 300, "window": "102", "kind": "AXUIElementDestroyed", "closes": true}
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

/// Review L1 of #13370 (at c72fac7d86, ruling R70bg): a gone event is a hint, never the answer.
/// A child destroyed in the tracked window does not end a gone wait; the window closing does; a
/// listing that fails answers its refusal. (The tracked window is the Save dialog 102, so the
/// observation of the target 101 that every waitFor returns can still be read.)
#[test]
fn a_gone_wait_is_confirmed_by_the_listing() {
    let gone = json!({
        "target": "101",
        "predicate": {"window": {"state": "gone", "title": "Save"}},
        "timeout": 1000
    });
    let mut child = Rig::new(json!({"ax_notification_timeline": [
        {"t_ms": 100, "window": "102", "kind": "AXUIElementDestroyed"}
    ]}));
    let result = child
        .session
        .wait_for(params(gone.clone()))
        .expect("waitFor");
    assert_eq!(
        result.outcome,
        WaitOutcome::Timeout,
        "a destroyed child is not the window closing"
    );
    let mut closed = Rig::new(json!({"ax_notification_timeline": [
        {"t_ms": 100, "window": "102", "kind": "AXUIElementDestroyed"},
        {"t_ms": 300, "window": "102", "kind": "AXUIElementDestroyed", "closes": true}
    ]}));
    let result = closed
        .session
        .wait_for(params(gone.clone()))
        .expect("waitFor");
    assert_eq!(result.outcome, WaitOutcome::Matched);
    assert!(
        (300..1_000).contains(&closed.clock.now_ms()),
        "matched at the close: {}",
        closed.clock.now_ms()
    );
    // The tracking read (the first listing) succeeds; the confirming read (the second) fails.
    let mut failing = Rig::new(json!({"ax_notification_timeline": [
        {"t_ms": 100, "window": "102", "kind": "AXUIElementDestroyed", "closes": true}
    ]}));
    failing.fail_listings_after(2);
    let refused = failing
        .session
        .wait_for(params(gone))
        .expect_err("a failed confirming read is answered");
    assert_eq!(
        refused.refusal.code,
        omo_computer_core::error::EngineCode::Internal
    );
}

/// Item 11 of the follow-up (ruling R70bi): when a wait matches because its target window is
/// gone, the reply is `matched` with an observation of nothing (no frame, no tree, 0 nodes, no
/// cuts, complete): the engine does not observe a window it just confirmed gone, and never
/// answers `WindowNotFound` for it.
#[test]
fn a_wait_that_matches_on_its_target_closing_answers_an_empty_observation() {
    let closes = json!({"ax_notification_timeline": [
        {"t_ms": 200, "window": "101", "kind": "AXUIElementDestroyed", "closes": true}
    ]});
    for predicate in [
        json!({"window": {"state": "gone"}}),
        json!({"event": {"kind": "window_closed"}}),
    ] {
        let mut rig = Rig::new(closes.clone());
        let result = rig
            .session
            .wait_for(params(
                json!({"target": "101", "predicate": predicate.clone(), "timeout": 1000}),
            ))
            .unwrap_or_else(|refused| panic!("{predicate}: matched, not {refused:?}"));
        assert_eq!(result.outcome, WaitOutcome::Matched, "{predicate}");
        let observed = &result.observation;
        assert_eq!(
            (
                observed.frame.is_none(),
                observed.tree.is_none(),
                observed.nodes_observed,
                observed.cuts.is_empty(),
                observed.complete
            ),
            (true, true, 0, true, true),
            "{predicate}: an observation of nothing"
        );
    }
}

/// Review L2 of #13391 (at c2a47beb10, ruling R70bw): an event `window_closed` wait is a hint
/// too. A destroyed child on the target, the window still listed, does not match; the close does.
#[test]
fn an_event_window_closed_wait_is_confirmed_by_the_listing() {
    let closed = json!({"target": "101", "predicate": {"event": {"kind": "window_closed"}}, "timeout": 1000});
    let mut child = Rig::new(json!({"ax_notification_timeline": [
        {"t_ms": 100, "window": "101", "kind": "AXUIElementDestroyed"}
    ]}));
    let result = child
        .session
        .wait_for(params(closed.clone()))
        .expect("waitFor");
    assert_eq!(
        result.outcome,
        WaitOutcome::Timeout,
        "a destroyed child is not the window closing"
    );
    let mut real = Rig::new(json!({"ax_notification_timeline": [
        {"t_ms": 100, "window": "101", "kind": "AXUIElementDestroyed"},
        {"t_ms": 300, "window": "101", "kind": "AXUIElementDestroyed", "closes": true}
    ]}));
    let result = real.session.wait_for(params(closed)).expect("waitFor");
    assert_eq!(result.outcome, WaitOutcome::Matched);
    assert!(
        (300..1_000).contains(&real.clock.now_ms()),
        "matched at the close: {}",
        real.clock.now_ms()
    );
}

/// Ruling R70ca: a failed confirming read answers THAT READ'S OWN refusal unchanged (code,
/// reason), never matched, never timeout, never re-mapped. A listing refused because its
/// permission was revoked arrives as `PermissionDenied{revoked}`.
#[test]
fn a_failed_confirming_read_answers_its_own_refusal_unchanged() {
    use omo_computer_core::backend::Refusal;
    use omo_computer_core::error::{EngineCode, Reason};
    let mut rig = Rig::new(json!({"ax_notification_timeline": [
        {"t_ms": 100, "window": "102", "kind": "AXUIElementDestroyed", "closes": true}
    ]}));
    let revoked = Refusal::new(EngineCode::PermissionDenied, Reason::Revoked.wire());
    rig.refuse_listings_after(2, revoked.clone());
    let refused = rig
        .session
        .wait_for(params(json!({
            "target": "101",
            "predicate": {"window": {"state": "gone", "title": "Save"}},
            "timeout": 1000
        })))
        .expect_err("the refused confirming read is answered");
    assert_eq!(refused.refusal, revoked, "the listing's refusal, unchanged");
}
