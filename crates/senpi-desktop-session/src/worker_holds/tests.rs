use senpi_desktop_backend_fake::{FakeMethod, SinkOp};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::protocol_params::{CaptureRegionParams, HoldKeysParams, HoldMouseParams};
use senpi_desktop_core::types::{CaptureRegion, DesktopPoint};
use serde_json::json;

use crate::request::Op;
use crate::test_support::{harness, Harness};

fn keys(duration: f64) -> Op {
    Op::HoldKeys(HoldKeysParams {
        target: "101".to_owned(),
        keys: vec!["ctrl".to_owned(), "shift".to_owned(), "a".to_owned()],
        duration,
        opts: None,
    })
}

fn transitions(harness: &Harness) -> Vec<(KeyName, bool)> {
    harness.sink.ops().into_iter().filter_map(|op| match op {
        SinkOp::HeldKey { key, down, .. } => Some((key, down)),
        _ => None,
    }).collect()
}

#[test]
fn bounded_keys_press_in_order_and_release_in_reverse() {
    // Given an admitted background keyboard target.
    let mut harness = harness(&json!({}));
    // When a zero-duration bounded hold runs.
    harness.process(keys(0.0)).unwrap();
    // Then every press has its reverse-ordered release before focus restore.
    assert_eq!(transitions(&harness), [
        (KeyName::Ctrl, true), (KeyName::Shift, true), (KeyName::Char('a'), true),
        (KeyName::Char('a'), false), (KeyName::Shift, false), (KeyName::Ctrl, false),
    ]);
    assert!(matches!(harness.sink.ops().last(), Some(SinkOp::RestoreKeyFocus(_))));
}

#[test]
fn bounded_keys_release_only_attempted_presses_after_partial_failure() {
    // Given a failure that may follow partial delivery of the first press.
    let mut harness = harness(&json!({}));
    harness.faults.fail_next(FakeMethod::KeyPress, ErrorCode::InputFailed);
    // When the hold attempts to press its keys.
    let error = harness.process(keys(0.0)).unwrap_err();
    // Then the attempted press is released, and later keys are not touched.
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert_eq!(transitions(&harness), [(KeyName::Ctrl, true), (KeyName::Ctrl, false)]);
}

#[test]
fn bounded_keys_append_release_failure_without_replacing_primary() {
    // Given both a partial press failure and a release failure.
    let mut harness = harness(&json!({}));
    harness.faults.fail_next(FakeMethod::KeyPress, ErrorCode::InputFailed);
    harness.faults.fail_next(FakeMethod::KeyRelease, ErrorCode::Internal);
    // When cleanup follows the delivery failure.
    let error = harness.process(keys(0.0)).unwrap_err();
    // Then the original code survives and the cleanup error is retained.
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(error.message.contains("KeyPress"));
    assert!(error.message.contains("KeyRelease"));
}

#[test]
fn bounded_keys_release_all_attempts_when_second_press_panics() {
    // Given a native panic after the second press may have been delivered.
    let mut harness = harness(&json!({}));
    harness.faults.panic_after(FakeMethod::KeyPress, 1);
    // When the real shared hold guard handles that backend unwind.
    let error = harness.process(keys(0.0)).unwrap_err();
    // Then both attempted keys release in reverse and the third is untouched.
    assert_eq!(error.code, ErrorCode::Internal);
    assert_eq!(transitions(&harness), [
        (KeyName::Ctrl, true), (KeyName::Shift, true),
        (KeyName::Shift, false), (KeyName::Ctrl, false),
    ]);
}

#[test]
fn bounded_keys_release_first_press_when_interrupted_between_presses() {
    for stop in [false, true] {
        // Given an interruption fired inside the first backend press.
        let mut harness = harness(&json!({}));
        let signal = harness.supervisor.hold_signal();
        harness.worker.hold_signal = Some(signal.clone());
        let supervisor = harness.supervisor.clone();
        let (committed_tx, committed) = std::sync::mpsc::channel();
        harness.faults.on_next(FakeMethod::KeyPress, move || {
            if stop {
                // A stop arrives from the tap or API thread, never from the worker:
                // the stop waits for this very hold to release its input. Refuse
                // input first, as trigger_stop does, so the next press sees it.
                supervisor.suspend_input();
                let supervisor = supervisor.clone();
                let committed_tx = committed_tx.clone();
                std::thread::spawn(move || {
                    supervisor.trigger_stop(senpi_desktop_safety::StopSource::Hotkey);
                    committed_tx.send(()).unwrap_or(());
                });
            } else {
                signal.cancel();
            }
        });
        // When the next press checks the real request signal.
        let error = harness.process(keys(0.0)).unwrap_err();
        if stop {
            committed
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("the stop commits once the first key is released");
        }
        // Then neither later key is pressed, and the first one releases.
        assert_eq!(error.code, if stop { ErrorCode::Suspended } else { ErrorCode::Cancelled });
        assert_eq!(transitions(&harness), [(KeyName::Ctrl, true), (KeyName::Ctrl, false)]);
    }
}

#[test]
fn invalid_hold_duration_and_empty_keys_send_no_input() {
    for duration in [f64::NAN, f64::INFINITY, -0.1, 100.1] {
        let mut harness = harness(&json!({}));
        let Op::HoldKeys(params) = keys(duration) else { unreachable!() };
        let parsed = serde_json::from_value::<HoldKeysParams>(serde_json::to_value(&params).unwrap());
        assert!(parsed.is_err(), "invalid duration reached the session boundary");
        // In-process callers bypassing serde still fail before mutate/release_all.
        assert_eq!(harness.process(Op::HoldKeys(params)).unwrap_err().code, ErrorCode::Internal);
        assert!(transitions(&harness).is_empty());
        assert!(!harness.sink.ops().contains(&SinkOp::ReleaseAll));
    }
    let mut harness = harness(&json!({}));
    let Op::HoldKeys(mut params) = keys(0.0) else { unreachable!() };
    params.keys.clear();
    assert_eq!(harness.process(Op::HoldKeys(params)).unwrap_err().code, ErrorCode::InvalidKey);
    assert!(transitions(&harness).is_empty());
}

#[test]
fn an_object_mode_hold_refused_for_its_duration_before_mutate_is_not_delivered_and_safe() {
    use senpi_desktop_core::report::{Disposition, ReportMode};
    use senpi_desktop_core::types::DesktopSessionOptions;
    // Given an object-mode session and a hold whose duration bypassed parsing.
    let mut harness = harness(&json!({}));
    harness.worker.open(DesktopSessionOptions {
        report_mode: ReportMode::Object,
        ..DesktopSessionOptions::default()
    });
    // When `hold_duration` refuses it before `mutate` runs.
    let error = harness.process(keys(f64::NAN)).unwrap_err();
    // Then the refusal says nothing was sent and a retry is safe.
    assert_eq!(error.code, ErrorCode::Internal);
    assert_eq!(
        error.report.and_then(|report| report.disposition),
        Some(Disposition::NOT_DELIVERED_SAFE)
    );
    assert!(transitions(&harness).is_empty());
}

#[test]
fn a_null_mode_hold_refused_for_its_duration_carries_no_report() {
    // Given a null-mode session.
    let mut harness = harness(&json!({}));
    // When the same refusal happens.
    let error = harness.process(keys(f64::NAN)).unwrap_err();
    // Then the legacy reply is unchanged: no report at all.
    assert_eq!(error.code, ErrorCode::Internal);
    assert_eq!(error.report, None);
}

#[test]
fn bounded_mouse_uses_full_frame_after_zoom_and_releases_partial_press() {
    // Given a full input frame followed by a native-detail zoom.
    let mut harness = harness(&json!({}));
    let frame = harness.capture("101");
    harness.process(Op::CaptureRegion(CaptureRegionParams {
        target: "101".to_owned(),
        region: CaptureRegion { x: 0.0, y: 0.0, width: 20.0, height: 20.0 },
        caps: None,
        frame_id: Some(frame.clone()),
    })).unwrap();
    harness.faults.fail_next(FakeMethod::MousePress, ErrorCode::InputFailed);
    // When a button press partially fails at a full-frame point outside the zoom.
    let result = harness.process(Op::HoldMouse(HoldMouseParams {
        target: "101".to_owned(), x: 100.0, y: 100.0, duration: 0.0,
        button: Some("right".to_owned()), keys: Some(vec!["shift".to_owned()]),
        frame_id: Some(frame), opts: None,
    }));
    // Then the button still releases before the modifier, using the full map.
    assert_eq!(result.unwrap_err().code, ErrorCode::InputFailed);
    let buttons: Vec<_> = harness.sink.ops().into_iter().filter_map(|op| match op {
        SinkOp::HeldButton { at, down, .. } => Some((at, down)),
        _ => None,
    }).collect();
    assert_eq!(buttons.len(), 2);
    assert!(buttons[0].1);
    assert!(!buttons[1].1);
    assert_eq!(buttons[0].0, buttons[1].0);
    assert_eq!(buttons[0].0, DesktopPoint { x: 200.0, y: 220.0 });
    assert_eq!(transitions(&harness), [(KeyName::Shift, true), (KeyName::Shift, false)]);
}

#[test]
fn bounded_button_hold_releases_on_success() {
    // Given a full frame for the same window target.
    let mut harness = harness(&json!({}));
    let frame = harness.capture("101");
    // When a zero-duration hold completes normally.
    harness.process(Op::HoldMouse(HoldMouseParams {
        target: "101".to_owned(),
        x: 10.0,
        y: 20.0,
        duration: 0.0,
        button: None,
        keys: None,
        frame_id: Some(frame),
        opts: None,
    })).unwrap();
    // Then both native transitions use the mapped full-frame point.
    let buttons: Vec<_> = harness.sink.ops().into_iter().filter_map(|op| match op {
        SinkOp::HeldButton { at, down, .. } => Some((at, down)),
        _ => None,
    }).collect();
    assert_eq!(buttons, [
        (DesktopPoint { x: 110.0, y: 140.0 }, true),
        (DesktopPoint { x: 110.0, y: 140.0 }, false),
    ]);
}

fn object_mode() -> Harness {
    use senpi_desktop_core::report::ReportMode;
    use senpi_desktop_core::types::DesktopSessionOptions;
    let mut harness = harness(&json!({}));
    harness.worker.open(DesktopSessionOptions { report_mode: ReportMode::Object, ..DesktopSessionOptions::default() });
    harness
}

fn assert_dangerous_hold_refused(error: &senpi_desktop_core::error::DesktopError) {
    use senpi_desktop_core::report::Disposition;
    assert_eq!(error.code, ErrorCode::InvalidKey);
    let report = error.report.as_deref().expect("object-mode refusal carries a report");
    assert_eq!(report.reason.as_deref(), Some("dangerous_chord"));
    assert_eq!(report.disposition, Some(Disposition::NOT_DELIVERED_SAFE));
    assert!(error.message.contains("keyChord"), "{}", error.message);
    assert!(error.message.contains("force: true"), "{}", error.message);
}

#[test]
fn an_object_mode_key_hold_of_a_dangerous_chord_is_refused_and_presses_nothing() {
    for held in [vec!["cmd", "q"], vec!["alt+f4"], vec!["win", "l"]] {
        // Given an object-mode session.
        let mut harness = object_mode();
        // When a hold asks for a chord that quits, closes or locks.
        let error = harness
            .process(Op::HoldKeys(HoldKeysParams {
                target: "101".to_owned(),
                keys: held.iter().map(|key| (*key).to_owned()).collect(),
                duration: 0.0,
                opts: None,
            }))
            .expect_err("a dangerous hold is refused");
        // Then it is the keyChord refusal, pointing at keyChord with force, and no key went down.
        assert_dangerous_hold_refused(&error);
        assert!(transitions(&harness).is_empty(), "{held:?} pressed {:?}", transitions(&harness));
    }
}

#[test]
fn an_object_mode_mouse_hold_with_dangerous_held_keys_is_refused_and_presses_nothing() {
    // Given an object-mode session with a full frame of the target.
    let mut harness = object_mode();
    let frame = harness.capture("101");
    // When a mouse hold also holds cmd+q.
    let error = harness
        .process(Op::HoldMouse(HoldMouseParams {
            target: "101".to_owned(), x: 10.0, y: 20.0, duration: 0.0, button: None,
            keys: Some(vec!["cmd".to_owned(), "q".to_owned()]), frame_id: Some(frame), opts: None,
        }))
        .expect_err("a dangerous held-key set is refused");
    // Then nothing was pressed: no key and no button.
    assert_dangerous_hold_refused(&error);
    assert!(transitions(&harness).is_empty());
    assert!(!harness.sink.ops().iter().any(|op| matches!(op, SinkOp::HeldButton { .. })));
}

#[test]
fn a_null_mode_key_hold_of_cmd_q_runs_as_protocol_1_did() {
    // Given a null-mode session.
    let mut harness = harness(&json!({}));
    // When the same hold runs.
    harness
        .process(Op::HoldKeys(HoldKeysParams {
            target: "101".to_owned(),
            keys: vec!["cmd".to_owned(), "q".to_owned()],
            duration: 0.0,
            opts: None,
        }))
        .expect("null mode is unchanged");
    // Then both keys go down and up.
    assert_eq!(transitions(&harness).len(), 4);
}
