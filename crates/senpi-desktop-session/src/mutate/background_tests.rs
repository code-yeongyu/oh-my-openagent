use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use senpi_desktop_backend_fake::{FakeMethod, SinkOp};
use senpi_desktop_core::background_action::BackgroundActionState;
use senpi_desktop_core::background_focus::{BackgroundFocusLease, SwitchSignals};
use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::protocol_params::TypeTextParams;
use serde_json::json;

use crate::request::Op;
use crate::test_support::{delivery, harness, Harness};

fn setup() -> (Harness, Arc<BackgroundActionState>) {
    let harness = harness(&json!({}));
    let state = Arc::new(BackgroundActionState::new(BackgroundFocusLease::new(
        4242,
        7,
        Some(101),
        SwitchSignals::default(),
        Instant::now(),
    )));
    *harness.watches.background.state.lock() = Some(Arc::clone(&state));
    (harness, state)
}

fn typing(target: &str, foreground: bool) -> Op {
    Op::TypeText(TypeTextParams {
        target: target.into(),
        text: "text".into(),
        opts: foreground.then(|| delivery("foreground")).flatten(),
    })
}

#[test]
fn the_named_background_action_hook_owns_only_background_window_input() {
    for (target, foreground, expected) in
        [("101", false, 1), ("101", true, 0), ("desktop", false, 0)]
    {
        let (mut h, _) = setup();
        h.grant("hook routing");
        h.process(typing(target, foreground)).expect("types");
        assert_eq!(h.watches.background.begins.load(Ordering::SeqCst), expected);
        assert_eq!(
            h.watches.background.finishes.load(Ordering::SeqCst),
            expected
        );
        assert_eq!(h.watches.background.drops.load(Ordering::SeqCst), expected);
        assert!(senpi_desktop_core::intervention::check_press().is_ok());
    }
}

#[test]
fn a_user_choice_stops_the_next_fake_press_and_prevents_snapshot_reclaim() {
    let (mut h, state) = setup();
    h.faults.on_next(FakeMethod::TypeText, move || {
        let now = Instant::now();
        let signals = SwitchSignals {
            buttons: [1, 0, 0, 0, 0, 0],
            last_click: Some(now),
            ..Default::default()
        };
        state.lease.lock().observe(7, None, signals, now);
    });
    let error = h.process(typing("101", false)).expect_err("user wins");
    assert_eq!(error.code, ErrorCode::UserIntervened);
    assert!(!h
        .sink
        .ops()
        .iter()
        .any(|op| matches!(op, SinkOp::TypeText { .. } | SinkOp::RestoreKeyFocus(_))));
    assert_eq!(h.watches.background.finishes.load(Ordering::SeqCst), 1);
    assert_eq!(h.watches.background.drops.load(Ordering::SeqCst), 1);
    assert!(
        senpi_desktop_core::intervention::check_press().is_ok(),
        "scope removed"
    );
}

#[test]
fn the_newer_own_app_window_replaces_the_post_action_snapshot() {
    let (mut h, state) = setup();
    h.faults.on_next(FakeMethod::TypeText, move || {
        let now = Instant::now();
        state.lease.lock().observe(
            4242,
            Some(202),
            SwitchSignals {
                buttons: [1, 0, 0, 0, 0, 0],
                last_click: Some(now),
                in_user_app: true,
                ..Default::default()
            },
            now,
        );
    });
    h.process(typing("101", false)).expect("types");
    let restored = h.sink.ops().into_iter().find_map(|op| match op {
        SinkOp::RestoreKeyFocus(front) => Some(front.window_id),
        _ => None,
    });
    assert_eq!(restored, Some(Some("202".into())));
}

#[test]
fn a_failed_or_panicked_action_still_finishes_and_drops_its_observer() {
    for panic in [false, true] {
        let (mut h, _) = setup();
        if panic {
            h.faults.panic_after(FakeMethod::TypeText, 0);
        } else {
            h.faults
                .fail_next(FakeMethod::TypeText, ErrorCode::InputFailed);
        }
        assert!(h.process(typing("101", false)).is_err());
        assert_eq!(h.watches.background.finishes.load(Ordering::SeqCst), 1);
        assert_eq!(h.watches.background.drops.load(Ordering::SeqCst), 1);
        assert!(senpi_desktop_core::intervention::check_press().is_ok());
    }
}

#[test]
fn an_app_left_in_front_is_an_audited_input_failure_not_a_rerunnable_refusal() {
    let (mut h, _) = setup();
    *h.watches.background.finish_error.lock() = Some(DesktopError::input_failed("came forward"));
    let error = h
        .process(typing("101", false))
        .expect_err("cleanup failure");
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(h
        .sink
        .ops()
        .iter()
        .any(|op| matches!(op, SinkOp::TypeText { .. })));
    assert_eq!(h.audits().len(), 1);
    assert_eq!(h.audits()[0].code, Some(ErrorCode::InputFailed));
}

#[test]
fn a_target_visit_during_settle_is_reported_after_the_last_press() {
    let (mut h, _) = setup();
    h.watches.background.visit_on_finish.store(true, Ordering::SeqCst);
    let error = h.process(typing("101", false)).expect_err("visit during settle");
    assert_eq!(error.code, ErrorCode::UserIntervened);
    assert!(h.sink.ops().iter().any(|op| matches!(op, SinkOp::TypeText { .. })));
    assert!(!h.sink.ops().iter().any(|op| matches!(op, SinkOp::RestoreKeyFocus(_))));
}

#[test]
fn waiting_for_user_quiet_does_not_hold_the_process_input_transaction() {
    use senpi_desktop_core::protocol_params::ClipboardText;
    use senpi_desktop_core::user_input::UserPressKind;
    use std::sync::mpsc::sync_channel;
    let mut first = harness(&json!({}));
    first.capture("101");
    first.user_pressed(4242, UserPressKind::Click);
    // Register both handshakes before admission begins. The second session
    // executes only once the first is inside its quiet-period wait.
    let (start_tx, start_rx) = sync_channel(1);
    let (done_tx, done_rx) = sync_channel(1);
    let other = std::thread::spawn(move || {
        let mut second = harness(&json!({}));
        start_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("admission entered");
        let result = second.process(Op::ClipboardWrite(ClipboardText {
            text: "independent".into(),
        }));
        done_tx.send(result.is_ok()).expect("first still waiting");
    });
    let once = std::cell::Cell::new(false);
    let faults = first.faults.clone();
    let windows_before = faults.calls(FakeMethod::Windows);
    let cancel = || {
        // An initial lock-admission cancellation probe is not the quiet wait.
        if faults.calls(FakeMethod::Windows) == windows_before {
            return false;
        }
        if !once.replace(true) {
            start_tx.send(()).expect("second waiting");
            assert!(done_rx
                .recv_timeout(Duration::from_secs(5))
                .expect("other session must acquire input while this waits"));
        }
        true
    };
    let result = first.worker.process(typing("101", false), &cancel);
    assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
    other.join().expect("other session");
}
