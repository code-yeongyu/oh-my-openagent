use senpi_desktop_backend_fake::{FakeMethod, SinkOp};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::TypeTextParams;

use super::TransactionError;
use crate::request::Op;
use crate::test_support::{
    click_window, delivery, foreground_click, foreground_click_mutation, harness, op_names, two_windows,
};

#[test]
fn background_click_never_warps_or_refocuses() {
    // Given
    let mut harness = harness(&two_windows());
    let frame = harness.capture("101");
    // When
    harness.process(click_window(&frame, None)).expect("clicks");
    // Then
    assert_eq!(op_names(&harness), ["pointer"]);
}

#[test]
fn foreground_click_restores_front_then_cursor_in_that_order() {
    // Given
    let mut harness = harness(&two_windows());
    let frame = harness.capture("101");
    // When
    harness
        .process(click_window(&frame, delivery("foreground")))
        .expect("clicks");
    // Then
    assert_eq!(op_names(&harness), ["front", "pointer", "restore-front", "warp"]);
    let restored: Vec<_> = harness
        .sink
        .ops()
        .into_iter()
        .filter_map(|op| match op {
            SinkOp::RestoreFrontWindow(front) => front.window_id,
            SinkOp::WarpCursor(point) => Some(format!("{},{}", point.x, point.y)),
            _ => None,
        })
        .collect();
    assert_eq!(restored, ["202", "960,540"]);
}

#[test]
fn background_keys_hand_key_focus_back_without_touching_the_cursor() {
    // Given
    let mut harness = harness(&two_windows());
    let op = Op::TypeText(TypeTextParams {
        target: "101".to_owned(),
        text: "hi".to_owned(),
        opts: None,
    });
    // When
    harness.process(op).expect("types");
    // Then
    assert_eq!(op_names(&harness), ["front", "type", "restore-key-focus"]);
}

#[test]
fn focus_restore_failure_after_a_successful_click_has_no_primary() {
    // Given
    let mut harness = harness(&two_windows());
    harness
        .faults
        .fail_next(FakeMethod::RestoreFrontWindow, ErrorCode::WindowNotFound);
    // When
    let (result, focus_restored) =
        harness
            .worker
            .transaction(&foreground_click_mutation(), &|| false, foreground_click);
    // Then
    assert!(
        matches!(
            result,
            Err(TransactionError::FocusRestoreFailed { primary: None, .. })
        ),
        "{result:?}"
    );
    assert_eq!(focus_restored, Some(false));
}

#[test]
fn focus_restore_failure_after_a_failed_click_keeps_the_primary() {
    // Given
    let mut harness = harness(&two_windows());
    harness
        .faults
        .fail_next(FakeMethod::Click, ErrorCode::InputFailed);
    harness
        .faults
        .fail_next(FakeMethod::RestoreFrontWindow, ErrorCode::WindowNotFound);
    // When
    let (result, _) = harness
        .worker
        .transaction(&foreground_click_mutation(), &|| false, foreground_click);
    // Then
    let primary = match result {
        Err(TransactionError::FocusRestoreFailed { primary, .. }) => primary.map(|error| error.code),
        other => panic!("expected FocusRestoreFailed, got {other:?}"),
    };
    assert_eq!(primary, Some(ErrorCode::InputFailed));
}

#[test]
fn cursor_restore_failure_after_a_failed_click_keeps_the_primary() {
    // Given
    let mut harness = harness(&two_windows());
    harness
        .faults
        .fail_next(FakeMethod::Click, ErrorCode::InputFailed);
    harness
        .faults
        .fail_next(FakeMethod::WarpCursor, ErrorCode::InputFailed);
    // When
    let (result, _) = harness
        .worker
        .transaction(&foreground_click_mutation(), &|| false, foreground_click);
    // Then
    let primary = match result {
        Err(TransactionError::CursorRestoreFailed { primary, .. }) => primary.map(|error| error.code),
        other => panic!("expected CursorRestoreFailed, got {other:?}"),
    };
    assert_eq!(primary, Some(ErrorCode::InputFailed));
}

#[test]
fn a_failed_restore_reaches_the_wire_and_the_audit_as_focus_restore_failed() {
    // Given
    let mut harness = harness(&two_windows());
    let frame = harness.capture("101");
    harness
        .faults
        .fail_next(FakeMethod::RestoreFrontWindow, ErrorCode::WindowNotFound);
    // When
    let reply = harness.process(click_window(&frame, delivery("foreground")));
    // Then
    assert_eq!(
        reply.map_err(|error| error.code),
        Err(ErrorCode::FocusRestoreFailed)
    );
    let audit = harness.audits().pop().expect("one audit");
    assert_eq!(
        (audit.code, audit.focus_restored),
        (Some(ErrorCode::FocusRestoreFailed), Some(false))
    );
}
