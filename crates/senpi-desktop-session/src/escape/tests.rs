use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{DesktopError, ErrorCode, TccPermission};
use senpi_desktop_core::protocol_params::ControlGrantParams;
use senpi_desktop_safety::{MutatingAction, StopPathFailure, StopPathId};
use serde_json::json;

use crate::mutate::Mutation;
use crate::request::Op;
use crate::test_support::harness;

fn grant(automatic: bool) -> Op {
    Op::ControlGrant(ControlGrantParams {
        reason: "test consent".into(),
        confirmation_id: "confirmed".into(),
        automatic,
    })
}

#[test]
fn automatic_consent_never_arms_the_idle_gap_but_held_control_does() {
    for automatic in [true, false] {
        let mut h = harness(&json!({}));
        h.process(grant(automatic)).unwrap();
        h.worker.escape.press();
        h.process(Op::ControlState).unwrap();
        assert_eq!(h.worker.escape.stops(), u32::from(!automatic));
        assert_eq!(h.worker.control.is_some(), automatic);
    }
}

#[test]
fn takeover_and_held_control_cancel_and_revoke_but_background_automatic_does_not() {
    for automatic in [true, false] {
        for delivery in [DeliveryMode::Background, DeliveryMode::Foreground] {
            let mut h = harness(&json!({}));
            h.process(grant(automatic)).unwrap();
            let mutation = Mutation::new(MutatingAction::TypeText, "101".into(), delivery);
            let result = h.worker.mutate(&mutation, &|| false, |worker| {
                worker.escape.press();
                Ok(())
            });
            let stopped = !automatic || delivery == DeliveryMode::Foreground;
            assert_eq!(result.as_ref().err().map(|e| e.code), stopped.then_some(ErrorCode::Cancelled));
            assert_eq!(h.worker.escape.stops(), u32::from(stopped));
            assert_eq!(h.worker.control.is_some(), !stopped);
            assert_eq!(h.audits().len(), 2, "grant plus one audited mutation");
            h.worker.escape.press();
            assert_eq!(h.worker.escape.stops(), u32::from(stopped));
        }
    }
}

#[test]
fn failure_and_pre_admission_cancellation_release_operation_arming() {
    for cancelled in [false, true] {
        let mut h = harness(&json!({}));
        h.process(grant(true)).unwrap();
        let mutation = Mutation::new(MutatingAction::TypeText, "101".into(), DeliveryMode::Foreground);
        let result = h.worker.mutate::<()>(&mutation, &|| cancelled, |_| {
            Err(DesktopError::input_failed("injected input failure"))
        });
        assert_eq!(result.unwrap_err().code, if cancelled { ErrorCode::Cancelled } else { ErrorCode::InputFailed });
        h.worker.escape.press();
        assert_eq!(h.worker.escape.stops(), 0);
    }
}

#[test]
fn desktop_input_and_ax_raise_are_takeover_even_with_background_delivery() {
    for (target, action, explicit_raise) in [
        ("desktop", MutatingAction::TypeText, false),
        ("display:1", MutatingAction::TypeText, false),
        ("101", MutatingAction::AxPerform, true),
    ] {
        let mut h = harness(&json!({}));
        h.process(grant(true)).unwrap();
        let mut mutation = Mutation::new(action, target.into(), DeliveryMode::Background);
        mutation.takes_over = explicit_raise;
        let result = h.worker.mutate(&mutation, &|| false, |worker| {
            worker.escape.press();
            Ok(())
        });
        assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
        assert_eq!(h.worker.escape.stops(), 1);
    }
}

#[test]
fn an_unavailable_watch_refuses_before_the_backend_action() {
    let mut h = harness(&json!({"escape_watch_off": true}));
    h.process(grant(true)).unwrap();
    let mutation = Mutation::new(MutatingAction::TypeText, "101".into(), DeliveryMode::Foreground);
    let result = h.worker.mutate::<()>(&mutation, &|| false, |_| panic!("input must not run"));
    assert_eq!(result.unwrap_err().code, ErrorCode::StopPathUnavailable);
    assert!(h.worker.control.is_none());
    assert_eq!(h.worker.escape.stops(), 0);
}

#[test]
fn takeover_preflight_preserves_the_actionable_accessibility_refusal() {
    for (target, delivery, action, raise) in [
        ("101", DeliveryMode::Background, MutatingAction::TypeText, false),
        ("101", DeliveryMode::Foreground, MutatingAction::TypeText, false),
        ("desktop", DeliveryMode::Background, MutatingAction::TypeText, false),
        ("display:1", DeliveryMode::Background, MutatingAction::TypeText, false),
        ("101", DeliveryMode::Background, MutatingAction::AxPerform, true),
    ] {
        let mut h = harness(&json!({}));
        h.supervisor.set_live(StopPathId::Global, false);
        h.supervisor.note_global_failure(Some(StopPathFailure::AccessibilityDenied));
        h.supervisor.set_live(StopPathId::HostRelay, true);
        let mut mutation = Mutation::new(action, target.into(), delivery);
        mutation.takes_over = raise;
        let error = h.worker.mutate::<()>(&mutation, &|| false, |_| panic!("input must not run"))
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::PermissionDenied);
        assert_eq!(error.permission.expect("backend permission payload").permission, TccPermission::Accessibility);
        assert!(h.sink.ops().is_empty());
    }
}
