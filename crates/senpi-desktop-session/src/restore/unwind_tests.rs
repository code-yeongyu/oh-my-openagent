//! gajae `executor.rs` transaction tests (release before restore, capture
//! failures, panics), ported onto `mutate()` and the fake backend's
//! `RecordingSink`. A failing fake call records nothing; a panicking one
//! (see `Panics`) records nothing either.

use senpi_desktop_backend_fake::FakeMethod;
use senpi_desktop_core::error::{CoreResult, ErrorCode};
use senpi_desktop_core::protocol_params::{DragParams, KeyChordParams};
use senpi_desktop_core::types::DesktopPoint;
use serde_json::json;

use super::TransactionError;
use crate::request::Op;
use crate::test_support::{
    click_window, delivery, foreground_click, foreground_click_mutation, harness, op_names, two_windows,
};

fn chord(mode: &str) -> Op {
    Op::KeyChord(KeyChordParams {
        target: "101".to_owned(),
        keys: vec!["enter".to_owned(), "tab".to_owned()],
        opts: delivery(mode),
    })
}

#[test]
fn keypress_backend_failure_releases_before_restore_and_keeps_primary_error() {
    let cases = [
        ("background", vec!["front", "release", "restore-key-focus"]),
        ("foreground", vec!["front", "release", "restore-front", "warp"]),
    ];
    for (mode, expected) in cases {
        // Given
        let mut harness = harness(&two_windows());
        harness
            .faults
            .fail_next(FakeMethod::KeyChord, ErrorCode::InputFailed);
        // When
        let reply = harness.process(chord(mode));
        // Then
        assert_eq!(
            reply.map_err(|error| error.code),
            Err(ErrorCode::InputFailed),
            "{mode}"
        );
        assert_eq!(op_names(&harness), expected, "{mode}");
    }
}

/// Held-input ownership is the backend's; the session's part is to re-attempt
/// `release_all` on every failed transaction until one succeeds.
#[test]
fn keypress_persistent_release_failure_retains_ownership_until_recovery() {
    // Given: the chord fails twice; the first release and restore fail too.
    let mut harness = harness(&json!({}));
    for method in [FakeMethod::KeyChord, FakeMethod::KeyChord, FakeMethod::ReleaseAll] {
        harness.faults.fail_next(method, ErrorCode::InputFailed);
    }
    harness
        .faults
        .fail_next(FakeMethod::RestoreKeyFocus, ErrorCode::WindowNotFound);
    let first = harness.process(chord("background"));
    assert_eq!(
        first.map_err(|error| error.code),
        Err(ErrorCode::FocusRestoreFailed)
    );
    // When: the next request fails again.
    let second = harness.process(chord("background"));
    // Then: that transaction released the held input (the first release
    // failed, so it recorded nothing).
    assert_eq!(second.map_err(|error| error.code), Err(ErrorCode::InputFailed));
    let releases = op_names(&harness)
        .into_iter()
        .filter(|op| *op == "release")
        .count();
    assert_eq!(releases, 1);
}

#[test]
fn transaction_captures_once_and_restore_failure_retains_primary() {
    // Given: a foreground drag off the frame, and a cursor that cannot return.
    let mut harness = harness(&two_windows());
    let frame_id = harness.capture("101");
    harness
        .faults
        .fail_next(FakeMethod::WarpCursor, ErrorCode::InputFailed);
    let op = Op::Drag(DragParams {
        target: "101".to_owned(),
        path: vec![
            DesktopPoint { x: 10.0, y: 10.0 },
            DesktopPoint { x: 5000.0, y: 10.0 },
        ],
        frame_id: Some(frame_id),
        opts: delivery("foreground"),
    });
    // When
    let reply = harness.process(op);
    // Then: one capture, one restore attempt (its queued failure is spent).
    assert_eq!(
        reply.map_err(|error| error.code),
        Err(ErrorCode::CursorRestoreFailed)
    );
    assert_eq!(op_names(&harness), ["front", "release", "restore-front"]);
    let next_warp = harness
        .worker
        .backend()
        .and_then(|backend| backend.warp_cursor(DesktopPoint { x: 0.0, y: 0.0 }));
    assert_eq!(next_warp, Ok(()));
}

#[test]
fn transaction_capture_failure_runs_no_input_or_restore() {
    // Given
    let mut harness = harness(&two_windows());
    let frame_id = harness.capture("101");
    harness
        .faults
        .fail_next(FakeMethod::CursorPosition, ErrorCode::InputFailed);
    // When
    let reply = harness.process(click_window(&frame_id, delivery("foreground")));
    // Then
    assert_eq!(
        reply.map_err(|error| error.code),
        Err(ErrorCode::TransactionFailed)
    );
    assert_eq!(op_names(&harness), ["front"]);
}

#[test]
fn transaction_panic_releases_held_input_and_restores_cursor() {
    // Given
    let mut harness = harness(&two_windows());
    // When: the backend panics right after delivering the click.
    let result = harness
        .worker
        .mutate(
            &foreground_click_mutation(),
            &|| false,
            |worker| -> CoreResult<()> {
                foreground_click(worker)?;
                panic!("injected transaction panic")
            },
        )
        .map(|((), _audit)| ());
    // Then
    assert_eq!(result.map_err(|error| error.code), Err(ErrorCode::Internal));
    assert_eq!(
        op_names(&harness),
        ["front", "pointer", "release", "restore-front", "warp"]
    );
}

#[test]
fn release_panic_still_restores_cursor_once() {
    // Given: the click fails and the release that follows it panics.
    let mut harness = harness(&two_windows());
    let frame_id = harness.capture("101");
    harness
        .faults
        .fail_next(FakeMethod::Click, ErrorCode::InputFailed);
    harness.panics.panic_next(FakeMethod::ReleaseAll);
    // When
    let reply = harness.process(click_window(&frame_id, delivery("foreground")));
    // Then: the primary survives and front + cursor are restored once each.
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::InputFailed));
    assert_eq!(op_names(&harness), ["front", "restore-front", "warp"]);
}

#[test]
fn restore_panic_is_mapped_without_escaping_transaction() {
    // Given
    let mut harness = harness(&two_windows());
    harness.panics.panic_next(FakeMethod::RestoreFrontWindow);
    // When
    let (result, focus_restored) =
        harness
            .worker
            .transaction(&foreground_click_mutation(), &|| false, foreground_click);
    // Then: mapped, and the cursor is still put back.
    assert!(
        matches!(
            result,
            Err(TransactionError::FocusRestoreFailed { primary: None, .. })
        ),
        "{result:?}"
    );
    assert_eq!(focus_restored, Some(false));
    assert_eq!(op_names(&harness), ["front", "pointer", "warp"]);
}
