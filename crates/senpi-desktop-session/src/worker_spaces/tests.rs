//! `window.bringToCurrentSpace` is admitted without the control grant (Q2,
//! omp parity), audited as background, and stops before the move.

use std::cell::Cell;
use std::sync::Arc;

use senpi_desktop_backend_fake::{FakeMethod, SinkOp};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_params::BringToCurrentSpaceParams;
use senpi_desktop_safety::StopSource;
use serde_json::json;

use crate::request::Op;
use crate::test_support::harness;

fn bring(id: &str) -> Op {
    Op::BringToCurrentSpace(BringToCurrentSpaceParams { window_id: id.to_owned() })
}

#[test]
fn bringing_a_window_to_the_current_space_needs_no_grant_and_is_audited() {
    // Given: nobody granted foreground control
    let mut harness = harness(&json!({}));
    assert!(harness.worker.control.is_none());
    // When
    let reply = harness.process(bring("101"));
    // Then: admitted, moved without any focus capture or restore, one audit
    assert!(reply.is_ok(), "{reply:?}");
    assert_eq!(harness.sink.ops(), [SinkOp::BringToCurrentSpace { id: "101".to_owned() }]);
    let audits = harness.audits();
    assert_eq!(audits.len(), 1, "{audits:?}");
    let audit = &audits[0];
    assert_eq!(
        (audit.action, audit.target.as_str(), audit.delivery.as_str(), audit.code),
        (Method::RaiseToSpace, "101", "background", None)
    );
    assert_eq!(audit.focus_restored, None);
}

#[test]
fn a_refused_move_is_audited_with_its_code() {
    // Given: the backend refuses the move
    let mut harness = harness(&json!({}));
    harness
        .faults
        .fail_next(FakeMethod::BringToCurrentSpace, ErrorCode::SpaceMoveDenied);
    // When
    let reply = harness.process(bring("101"));
    // Then
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::SpaceMoveDenied));
    let codes: Vec<_> = harness.audits().into_iter().map(|audit| audit.code).collect();
    assert_eq!(codes, [Some(ErrorCode::SpaceMoveDenied)]);
}

#[test]
fn an_unknown_window_is_window_not_found_and_moves_nothing() {
    let mut harness = harness(&json!({}));
    let reply = harness.process(bring("999"));
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::WindowNotFound));
    // A failed mutation releases held input; nothing was moved.
    assert_eq!(harness.sink.ops(), [SinkOp::ReleaseAll]);
}

#[test]
fn a_stop_racing_cancellation_before_the_move_reports_suspended_and_moves_nothing() {
    // Given: admission and the transaction's own stop check pass; the third
    // probe is the backend's check before the move, where a stop races the
    // cancellation
    let mut harness = harness(&json!({}));
    let supervisor = Arc::clone(&harness.supervisor);
    let calls = Cell::new(0);
    let racing = || {
        calls.set(calls.get() + 1);
        if calls.get() < 3 {
            return false;
        }
        supervisor.trigger_stop(StopSource::Hotkey);
        true
    };
    // When
    let reply = harness.worker.process(bring("101"), &racing);
    // Then
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::Suspended));
    assert!(calls.get() >= 3, "the backend consulted the probe: {}", calls.get());
    assert!(
        !harness.sink.ops().iter().any(|op| matches!(op, SinkOp::BringToCurrentSpace { .. })),
        "{:?}",
        harness.sink.ops()
    );
}
