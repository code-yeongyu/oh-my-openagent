//! The post-send settle picks its regime from what it saw, and the busy wait before a send.

use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::observation::SettleOutcome;
use omo_computer_core::settle_profile::SettleRegime;
use serde_json::{json, Value};

use super::{expected, report_settle, Rig};

#[test]
fn after_input_changed_settles_at_150ms_quiet() {
    let mut rig = Rig::new(json!({
        "ax_notification_timeline": [{"t_ms": 100, "window": "101", "kind": "AXValueChanged"}]
    }));
    let reply = rig.click().expect("the click is sent");
    assert_eq!(
        report_settle(&reply),
        expected(SettleOutcome::Settled, SettleRegime::Changed, 150, 250)
    );
    assert_eq!(
        rig.clock.now_ms(),
        250,
        "150 ms of quiet after the change at 100 ms"
    );
    assert_eq!(rig.sink.len(), 3, "move, down, up: {:?}", rig.sink.lines());
}

#[test]
fn after_input_unchanged_waits_500ms() {
    let mut rig = Rig::new(json!({}));
    let reply = rig.click().expect("the click is sent");
    assert_eq!(
        report_settle(&reply),
        expected(SettleOutcome::Settled, SettleRegime::Unchanged, 500, 500)
    );
    assert_eq!(rig.clock.now_ms(), 500);
}

#[test]
fn navigation_settles_at_600ms_quiet_cap_2000() {
    let mut rig = Rig::new(json!({
        "ax_notification_timeline": [{"t_ms": 100, "window": "101", "kind": "AXWindowCreated"}]
    }));
    let reply = rig.click().expect("the click is sent");
    assert_eq!(
        report_settle(&reply),
        expected(SettleOutcome::Settled, SettleRegime::Navigation, 600, 700)
    );
    // A navigation followed by a change every 300 ms never goes quiet: pending at the cap.
    let events: Vec<Value> = (0..8)
        .map(|i| {
            let kind = if i == 0 {
                "AXWindowCreated"
            } else {
                "AXValueChanged"
            };
            json!({"t_ms": 100 + 300 * i, "window": "101", "kind": kind})
        })
        .collect();
    let mut rig = Rig::new(json!({ "ax_notification_timeline": events }));
    let reply = rig.click().expect("the click is sent");
    assert_eq!(
        report_settle(&reply),
        expected(SettleOutcome::Pending, SettleRegime::Navigation, 600, 2_000)
    );
    assert_eq!(rig.clock.now_ms(), 2_000, "never past the cap");
}

#[test]
fn exec_on_busy_target_at_cap_sends_nothing_and_is_input_busy() {
    let mut rig = Rig::new(json!({
        "busy_timeline": [{"t_ms": 0, "window": "101", "busy": true, "indicator": "spinner"}]
    }));
    let refused = rig.click().expect_err("a busy target is not sent to");
    assert_eq!(
        (refused.refusal.code, refused.refusal.reason),
        (EngineCode::InputBusy, Some(Reason::TargetBusy.wire()))
    );
    assert!(rig.sink.is_empty(), "nothing sent: {:?}", rig.sink.lines());
    assert_eq!(
        rig.clock.now_ms(),
        1_000,
        "the unchanged regime's cap, never longer"
    );
}
