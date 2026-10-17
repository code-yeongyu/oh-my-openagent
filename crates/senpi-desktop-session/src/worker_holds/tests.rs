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
