use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol::ERROR_CODES;
use senpi_desktop_core::report::{
    ActionEffect, Disposition, FocusRestoration, Progress, ReportMode,
};
use senpi_desktop_core::types::DesktopSessionOptions;
use serde_json::json;

use super::{settled, Stage};
use crate::request::{Op, Response};
use crate::test_support::{click_window, harness, Harness};

const STAGES: [Stage; 3] = [Stage::Admission, Stage::Acting, Stage::Acted];

fn progresses() -> [Progress; 4] {
    [
        Progress::Atomic,
        Progress::Counted { count: 0, of: 3 },
        Progress::Counted { count: 2, of: 3 },
        Progress::Counted { count: 3, of: 3 },
    ]
}

fn object_harness() -> Harness {
    object_harness_with(&json!({}))
}

fn object_harness_with(overlay: &serde_json::Value) -> Harness {
    let mut harness = harness(overlay);
    harness.worker.open(DesktopSessionOptions {
        report_mode: ReportMode::Object,
        ..DesktopSessionOptions::default()
    });
    harness
}

#[test]
fn every_error_code_settles_to_one_of_the_seven_pairs() {
    for code in ERROR_CODES {
        for stage in STAGES {
            for progress in progresses() {
                // When
                let disposition = settled(Some(code), stage, progress).disposition();
                // Then
                assert!(
                    Disposition::ALL.contains(&disposition),
                    "{code:?} {stage:?} {progress:?}"
                );
                if stage == Stage::Admission {
                    assert!(
                        matches!(disposition, Disposition::NotDelivered { .. }),
                        "{code:?}: {disposition:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn gate_refusals_need_the_user_only_for_stops_permissions_and_locks() {
    let at_admission = |code| settled(Some(code), Stage::Admission, Progress::Atomic).disposition();
    for code in [
        ErrorCode::Suspended,
        ErrorCode::StopPathUnavailable,
        ErrorCode::PermissionDenied,
        ErrorCode::ScreenLocked,
    ] {
        assert_eq!(
            at_admission(code),
            Disposition::NOT_DELIVERED_AFTER_USER,
            "{code:?}"
        );
    }
    for code in [
        ErrorCode::TransactionFailed,
        ErrorCode::InvalidCoordinateFrame,
        ErrorCode::Cancelled,
    ] {
        assert_eq!(
            at_admission(code),
            Disposition::NOT_DELIVERED_SAFE,
            "{code:?}"
        );
    }
}

#[test]
fn errors_raised_while_acting_follow_what_may_have_been_sent() {
    let acting = |code, progress| settled(Some(code), Stage::Acting, progress).disposition();
    let partly = Progress::Counted { count: 2, of: 3 };
    assert_eq!(
        acting(ErrorCode::Suspended, partly),
        Disposition::DELIVERED_UNVERIFIED
    );
    assert_eq!(
        acting(ErrorCode::Cancelled, Progress::Counted { count: 0, of: 3 }),
        Disposition::NOT_DELIVERED_SAFE
    );
    assert_eq!(
        acting(ErrorCode::Cancelled, Progress::Atomic),
        Disposition::UNCERTAIN_UNSAFE
    );
    assert_eq!(
        acting(ErrorCode::InputFailed, partly),
        Disposition::UNCERTAIN_UNKNOWN
    );
    assert_eq!(
        acting(ErrorCode::AxUnconfirmed, Progress::Atomic),
        Disposition::UNCERTAIN_UNSAFE
    );
    assert_eq!(
        acting(ErrorCode::Internal, Progress::Atomic),
        Disposition::UNKNOWN
    );
    assert_eq!(
        acting(ErrorCode::InvalidCoordinateFrame, Progress::Atomic),
        Disposition::NOT_DELIVERED_SAFE
    );
    assert_eq!(
        settled(None, Stage::Acted, Progress::Atomic).disposition(),
        Disposition::DELIVERED_UNVERIFIED
    );
}

#[test]
fn an_object_mode_click_answers_an_action_report_naming_its_audit() {
    // Given
    let mut harness = object_harness();
    let frame = harness.capture("101");
    // When
    let reply = harness
        .process(click_window(&frame, None))
        .expect("click succeeds");
    // Then
    let Response::Action(report) = reply else {
        panic!("expected an action report, got {reply:?}");
    };
    assert_eq!(report.disposition, Disposition::DELIVERED_UNVERIFIED);
    assert_eq!(report.effect, ActionEffect::Unverifiable);
    assert_eq!(report.focus_restoration, FocusRestoration::NotNeeded);
    let audit_id = harness
        .audits()
        .last()
        .and_then(|event| event.id.clone())
        .expect("the audit carries an id");
    assert_eq!(report.audit_ids, vec![audit_id]);
}

#[test]
fn a_null_mode_click_stays_unit_with_an_unnumbered_audit() {
    let mut harness = harness(&json!({}));
    let frame = harness.capture("101");
    let reply = harness
        .process(click_window(&frame, None))
        .expect("click succeeds");
    assert_eq!(reply, Response::Unit);
    assert_eq!(
        harness.audits().last().and_then(|event| event.id.clone()),
        None
    );
}

#[test]
fn object_mode_errors_carry_their_disposition_and_null_mode_errors_do_not() {
    // Given a frame the click does not name, and a click the backend fails
    let mut object =
        object_harness_with(&json!({"fail_next": [{"method": "click", "code": "InputFailed"}]}));
    object.capture("101");
    let stale = object
        .process(click_window("frame-from-another-capture", None))
        .expect_err("stale frame");
    let frame = object.capture("101");
    let failed = object
        .process(click_window(&frame, None))
        .expect_err("injected failure");
    let mut null = harness(&json!({}));
    null.capture("101");
    let plain = null
        .process(click_window("frame-from-another-capture", None))
        .expect_err("stale frame");
    // Then
    let disposition = |error: &senpi_desktop_core::error::DesktopError| {
        error.report.as_ref().and_then(|report| report.disposition)
    };
    assert_eq!(stale.code, ErrorCode::InvalidCoordinateFrame);
    assert_eq!(disposition(&stale), Some(Disposition::NOT_DELIVERED_SAFE));
    assert_eq!(failed.code, ErrorCode::InputFailed);
    assert_eq!(disposition(&failed), Some(Disposition::UNCERTAIN_UNKNOWN));
    assert_eq!(plain.report, None);
}

#[test]
fn a_stopped_object_mode_session_refuses_with_after_user() {
    let mut harness = object_harness();
    let frame = harness.capture("101");
    harness
        .supervisor
        .trigger_stop(senpi_desktop_safety::StopSource::Hotkey);
    let error = harness
        .process(click_window(&frame, None))
        .expect_err("suspended");
    assert_eq!(error.code, ErrorCode::Suspended);
    let report = error.report.expect("object-mode errors carry a report");
    assert_eq!(
        report.disposition,
        Some(Disposition::NOT_DELIVERED_AFTER_USER)
    );
    assert_eq!(report.focus_restoration, Some(FocusRestoration::NotNeeded));
}

#[test]
fn a_reopen_that_changes_report_mode_recreates_the_backend_and_never_reuses_a_frame_id() {
    // Given a captured window in a null-mode session
    let mut harness = harness(&json!({}));
    let before = harness.capture("101");
    // When the session is reopened in object mode
    harness.worker.open(DesktopSessionOptions {
        report_mode: ReportMode::Object,
        ..DesktopSessionOptions::default()
    });
    // Then the old frame is gone, and the next capture gets a fresh id
    let stale = harness
        .process(click_window(&before, None))
        .expect_err("frames were dropped");
    assert_eq!(stale.code, ErrorCode::InvalidCoordinateFrame);
    let after = harness.capture("101");
    assert_ne!(before, after);
    assert!(after.starts_with("frame-"), "{after}");
    assert_eq!(harness.worker.registry.report_mode(), ReportMode::Object);
}

#[test]
fn a_null_mode_session_keeps_the_v1_frame_id_shape_and_object_mode_gets_the_process_wide_one() {
    // Given a v1 (reportMode null) session
    let mut legacy = harness(&json!({}));
    // When it captures twice
    let first = legacy.capture("101");
    let second = legacy.capture("101");
    // Then the ids keep the v1 shape `frame-<n>`, counted per open
    assert_eq!((first.as_str(), second.as_str()), ("frame-1", "frame-2"));
    // And a null-mode reopen restarts the v1 count as it always did
    legacy.worker.open(DesktopSessionOptions::default());
    assert_eq!(legacy.capture("101"), "frame-1");
    // While an object-mode session gets `frame-<engine instance>-<counter>`
    let mut object = object_harness();
    let id = object.capture("101");
    let parts: Vec<&str> = id.splitn(3, '-').collect();
    assert_eq!(parts.len(), 3, "{id}");
    assert_eq!(parts[0], "frame");
    assert_eq!(parts[1].len(), 26, "{id}");
    assert!(parts[2].parse::<u64>().is_ok(), "{id}");
}

#[test]
fn an_object_mode_ax_type_text_keeps_its_method_and_adds_a_report() {
    let mut harness = object_harness();
    let reference = harness.focused_ref();
    let params = senpi_desktop_core::protocol_params::AxTypeTextParams {
        ref_: reference,
        text: "hi".to_owned(),
        opts: None,
    };
    let reply = harness.process(Op::AxTypeText(params));
    let Ok(Response::AxInput(result)) = reply else {
        panic!("expected an AxInputResult, got {reply:?}");
    };
    let report = result.report.expect("object mode adds the report");
    assert_eq!(report.disposition, Disposition::DELIVERED_UNVERIFIED);
}

#[test]
fn a_refusal_raised_after_units_were_sent_keeps_the_delivered_count() {
    // Given typing that sent 2 of 3 scalars before the backend refused the rest
    let partly = Progress::Counted { count: 2, of: 3 };
    for code in [
        ErrorCode::BackgroundUnavailable,
        ErrorCode::WindowNotFound,
        ErrorCode::PermissionDenied,
        ErrorCode::ScreenLocked,
    ] {
        // When it settles
        let shape = settled(Some(code), Stage::Acting, partly);
        // Then it reports the partial delivery, not "nothing delivered"
        assert_eq!(
            shape.disposition(),
            Disposition::DELIVERED_UNVERIFIED,
            "{code:?}"
        );
        let delivered = shape.delivered().map(|d| (d.count, d.of));
        assert_eq!(delivered, Some((2, 3)), "{code:?}");
    }
    // A refusal before the first unit is still not_delivered.
    let none = settled(
        Some(ErrorCode::BackgroundUnavailable),
        Stage::Acting,
        Progress::Counted { count: 0, of: 3 },
    );
    assert_eq!(none.disposition(), Disposition::NOT_DELIVERED_SAFE);
}
