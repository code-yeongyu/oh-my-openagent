use std::sync::Arc;

use senpi_desktop_backend_fake::{FakeMethod, SinkOp};
use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, ErrorCode};
use senpi_desktop_core::keys::parse_keys;
use senpi_desktop_core::protocol_params::{
    AxClickParams, AxPerformParams, AxRefParams, AxSetValueParams, DragParams, KeyChordParams, PointParams,
    RaiseWindowParams, ScrollParams, TypeTextParams,
};
use senpi_desktop_core::types::{DesktopPoint, Target};
use senpi_desktop_safety::{MutatingAction, StopPathId, StopSource};
use serde_json::json;

use super::Mutation;
use crate::request::Op;
use crate::test_support::{click_window, harness, Harness};

fn click_desktop_mutation() -> Mutation<'static> {
    Mutation::new(
        MutatingAction::Click,
        "desktop".to_owned(),
        DeliveryMode::Background,
    )
}

fn released(harness: &Harness) -> bool {
    harness.sink.ops().contains(&SinkOp::ReleaseAll)
}

#[test]
fn gate_refusal_is_audited_and_touches_no_backend_state() {
    // Given: no stop path is live - a refusal only the gate itself makes
    // (admission already refuses a suspended session before the gate).
    let mut harness = harness(&json!({}));
    let frame = harness.capture("101");
    harness.supervisor.set_live(StopPathId::Global, false);
    // When
    let reply = harness.process(click_window(&frame, None));
    // Then
    assert_eq!(
        reply.map_err(|error| error.code),
        Err(ErrorCode::StopPathUnavailable)
    );
    assert_eq!(harness.sink.ops(), Vec::new());
    let codes: Vec<_> = harness.audits().into_iter().map(|audit| audit.code).collect();
    assert_eq!(codes, [Some(ErrorCode::StopPathUnavailable)]);
}

#[test]
fn panicking_backend_releases_all_and_reports_internal() {
    // Given
    let mut harness = harness(&json!({}));
    // When
    let result = harness
        .worker
        .mutate(&click_desktop_mutation(), &|| false, |worker| -> CoreResult<()> {
            worker.backend()?;
            panic!("scripted backend panic")
        });
    // Then
    assert_eq!(result.map_err(|error| error.code), Err(ErrorCode::Internal));
    assert!(released(&harness), "{:?}", harness.sink.ops());
}

#[test]
fn error_path_release_failure_does_not_mask_primary() {
    // Given: the click fails, and so does the release that follows it.
    let mut harness = harness(&json!({}));
    let frame = harness.capture("101");
    harness
        .faults
        .fail_next(FakeMethod::Click, ErrorCode::InputFailed);
    harness
        .faults
        .fail_next(FakeMethod::ReleaseAll, ErrorCode::Internal);
    // When
    let reply = harness.process(click_window(&frame, None));
    // Then: the primary survives, and the failing release was attempted
    // (its queued failure is spent).
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::InputFailed));
    let next_release = harness.worker.backend().and_then(|backend| backend.release_all());
    assert_eq!(next_release, Ok(()));
}

#[test]
fn suspension_observed_midflight_releases_all() {
    // Given: a stop lands while the action runs.
    let mut harness = harness(&json!({}));
    let supervisor = Arc::clone(&harness.supervisor);
    // When
    let result = harness.worker.mutate(&click_desktop_mutation(), &|| false, |_| {
        supervisor.trigger_stop(StopSource::HostRelay);
        Ok(())
    });
    // Then
    assert_eq!(result.map_err(|error| error.code), Err(ErrorCode::Suspended));
    assert!(released(&harness), "{:?}", harness.sink.ops());
}

/// A valid request for `action` against the fixture, or `None` when the
/// session has no op for it yet.
fn request_for(harness: &mut Harness, action: MutatingAction) -> Option<Op> {
    let frame = harness.capture("101");
    let frame_id = Some(frame.clone());
    let reference = harness.focused_ref();
    let target = "101".to_owned();
    let point = |x, y| DesktopPoint { x, y };
    let op = match action {
        MutatingAction::Click => click_window(&frame, None),
        MutatingAction::MoveMouse => Op::MoveMouse(PointParams {
            target,
            x: 10.0,
            y: 10.0,
            frame_id,
            opts: None,
        }),
        MutatingAction::Drag => Op::Drag(DragParams {
            target,
            path: vec![point(10.0, 10.0), point(40.0, 40.0)],
            frame_id,
            opts: None,
        }),
        MutatingAction::Scroll => Op::Scroll(ScrollParams {
            target,
            x: 10.0,
            y: 10.0,
            dx: 0.0,
            dy: 3.0,
            frame_id,
            opts: None,
        }),
        MutatingAction::TypeText => Op::TypeText(TypeTextParams {
            target,
            text: "hello".to_owned(),
            opts: None,
        }),
        MutatingAction::KeyChord => Op::KeyChord(KeyChordParams {
            target,
            keys: vec!["shift+a".to_owned()],
            opts: None,
        }),
        MutatingAction::RaiseWindow => Op::RaiseWindow(RaiseWindowParams { window_id: target }),
        MutatingAction::AxPerform => Op::AxPerform(AxPerformParams {
            ref_: reference,
            action: "focus".to_owned(),
        }),
        MutatingAction::AxSetValue => Op::AxSetValue(AxSetValueParams {
            ref_: reference,
            value: "hello".to_owned(),
        }),
        MutatingAction::AxFocus => Op::AxFocus(AxRefParams { ref_: reference }),
        MutatingAction::AxClick => Op::AxClick(AxClickParams {
            ref_: reference,
            opts: None,
        }),
        // No session op yet: `clipboard.write` arrives with the backends'
        // clipboard support and must route through `mutate` then.
        MutatingAction::ClipboardWrite => return None,
    };
    Some(op)
}

#[test]
fn every_mutating_request_emits_one_audit_event() {
    for action in MutatingAction::ALL {
        // Given
        let mut harness = harness(&json!({}));
        let Some(op) = request_for(&mut harness, action) else {
            continue;
        };
        // When
        let reply = harness.process(op);
        // Then
        assert!(reply.is_ok(), "{action:?}: {reply:?}");
        let audited: Vec<_> = harness
            .audits()
            .into_iter()
            .map(|audit| (audit.action, audit.code))
            .collect();
        assert_eq!(audited, [(action.method(), None)], "{action:?}");
    }
}

#[test]
fn typed_text_is_audited_by_length_and_digest_only() {
    // Given
    let mut harness = harness(&json!({}));
    let op = Op::TypeText(TypeTextParams {
        target: "101".to_owned(),
        text: "abc".to_owned(),
        opts: None,
    });
    // When
    harness.process(op).expect("types");
    // Then: SHA-256("abc") starts ba7816bf8f01cfea.
    let audit = harness.audits().pop().expect("one audit");
    assert_eq!(
        (audit.text_length, audit.text_sha256.as_deref()),
        (Some(3), Some("ba7816bf8f01cfea"))
    );
}

#[test]
fn cursor_warp_failure_maps_through_execute_input() {
    // Given: the backend fails the pointer move itself.
    let mut harness = harness(&json!({}));
    let frame_id = harness.capture("101");
    harness.faults.fail_next(FakeMethod::Move, ErrorCode::InputFailed);
    let op = Op::MoveMouse(PointParams {
        target: "101".to_owned(),
        x: 10.0,
        y: 10.0,
        frame_id: Some(frame_id),
        opts: None,
    });
    // When
    let reply = harness.process(op);
    // Then: the backend's code is the reply and the audit.
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::InputFailed));
    let codes: Vec<_> = harness.audits().into_iter().map(|audit| audit.code).collect();
    assert_eq!(codes, [Some(ErrorCode::InputFailed)]);
}

#[test]
fn out_of_bounds_coordinate_errors_and_releases() {
    // Given: a drag whose second point is off the captured frame.
    let mut harness = harness(&json!({}));
    let frame_id = harness.capture("101");
    let op = Op::Drag(DragParams {
        target: "101".to_owned(),
        path: vec![
            DesktopPoint { x: 0.0, y: 0.0 },
            DesktopPoint { x: 999_999.0, y: 0.0 },
        ],
        frame_id: Some(frame_id),
        opts: None,
    });
    // When
    let reply = harness.process(op);
    // Then: no pointer input, and anything held is released.
    assert_eq!(
        reply.map_err(|error| error.code),
        Err(ErrorCode::InvalidCoordinateFrame)
    );
    assert_eq!(harness.sink.ops(), [SinkOp::ReleaseAll]);
}

#[test]
fn type_and_keypress_pass_the_gate() {
    // Given
    let mut harness = harness(&json!({}));
    let target = Target::Window("101".to_owned());
    let typed = Op::TypeText(TypeTextParams {
        target: "101".to_owned(),
        text: "hi".to_owned(),
        opts: None,
    });
    let pressed = Op::KeyChord(KeyChordParams {
        target: "101".to_owned(),
        keys: vec!["enter".to_owned()],
        opts: None,
    });
    // When
    harness.process(typed).expect("types");
    harness.process(pressed).expect("presses");
    // Then
    let sent: Vec<_> = harness
        .sink
        .ops()
        .into_iter()
        .filter(|op| matches!(op, SinkOp::TypeText { .. } | SinkOp::KeyChord { .. }))
        .collect();
    let expected = [
        SinkOp::TypeText {
            target: target.clone(),
            text: "hi".to_owned(),
            mode: DeliveryMode::Background,
        },
        SinkOp::KeyChord {
            target,
            keys: parse_keys(&["enter".to_owned()]).expect("enter is a key"),
            mode: DeliveryMode::Background,
        },
    ];
    assert_eq!(sent, expected);
}
