//! Foreground delivery needs this session's live control grant
//! (`control.grant`); background delivery never does. A grant the user
//! interrupted or revoked, or one whose generation the queued request no
//! longer matches, admits nothing.

use std::sync::Arc;

use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_safety::StopSource;
use serde_json::json;

use crate::grant::test_lock;
use crate::test_support::{
    click_window, delivery, foreground_click, foreground_click_mutation, grant_control, harness, op_names, two_windows,
    Harness,
};
use crate::worker::Worker;

fn granted_foreground_click(_harness: &Harness) -> fn(&mut Worker) -> senpi_desktop_core::error::CoreResult<()> {
    foreground_click
}

#[test]
fn foreground_without_a_grant_is_refused_without_input_or_capture() {
    let _lock = test_lock().lock();
    // Given
    let mut harness = harness(&two_windows());
    let frame = harness.capture("101");
    // When
    let reply = harness.process(click_window(&frame, delivery("foreground")));
    // Then: refused before the gate or any backend call, still audited.
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::ControlRequired));
    assert_eq!(harness.sink.ops(), Vec::new());
    let audited: Vec<_> = harness.audits().into_iter().map(|audit| audit.code).collect();
    assert_eq!(audited, [Some(ErrorCode::ControlRequired)]);
}

#[test]
fn background_delivery_needs_no_grant() {
    let _lock = test_lock().lock();
    // Given
    let mut harness = harness(&two_windows());
    let frame = harness.capture("101");
    // When
    let reply = harness.process(click_window(&frame, None));
    // Then
    assert!(reply.is_ok(), "{reply:?}");
    assert_eq!(op_names(&harness), ["pointer"]);
}

#[test]
fn a_granted_session_may_deliver_to_the_foreground() {
    let _lock = test_lock().lock();
    // Given
    let mut harness = harness(&two_windows());
    let frame = harness.capture("101");
    harness
        .process(grant_control("with the human watching"))
        .expect("grants");
    // When
    let reply = harness.process(click_window(&frame, delivery("foreground")));
    // Then
    assert!(reply.is_ok(), "{reply:?}");
    assert_eq!(op_names(&harness), ["front", "pointer", "restore-front", "warp"]);
}

#[test]
fn a_revoked_grant_refuses_the_next_foreground_delivery() {
    let _lock = test_lock().lock();
    // Given
    let mut harness = harness(&two_windows());
    let frame = harness.capture("101");
    harness.process(grant_control("one action")).expect("grants");
    // When
    harness.process(crate::request::Op::ControlRevoke).expect("revokes");
    let reply = harness.process(click_window(&frame, delivery("foreground")));
    // Then
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::ControlRequired));
    assert_eq!(harness.sink.ops(), Vec::new());
}

#[test]
fn a_suspension_revokes_the_grant_and_resume_does_not_restore_it() {
    let _lock = test_lock().lock();
    // Given
    let mut harness = harness(&two_windows());
    let frame = harness.capture("101");
    harness.process(grant_control("watching")).expect("grants");
    // When: the user interrupts and then resumes
    harness.supervisor.trigger_stop(StopSource::Hotkey);
    harness.supervisor.reset_for_test();
    harness
        .supervisor
        .set_live(senpi_desktop_safety::StopPathId::Global, true);
    // Then: background works, foreground does not
    let background = harness.process(click_window(&frame, None));
    assert!(background.is_ok(), "{background:?}");
    let foreground = harness.process(click_window(&frame, delivery("foreground")));
    assert_eq!(foreground.map_err(|error| error.code), Err(ErrorCode::ControlRequired));
    assert_eq!(op_names(&harness), ["pointer"]);
}

#[test]
fn an_op_queued_before_a_revoke_and_regrant_never_runs_under_the_new_grant() {
    let _lock = test_lock().lock();
    // Given: a grant held, then replaced before a queued op is served.
    let mut harness = harness(&two_windows());
    harness.process(grant_control("first")).expect("grants");
    let stale = harness.queue_generation();
    assert!(stale.is_some(), "queued while granted");
    // When
    harness.process(crate::request::Op::ControlRevoke).expect("revokes");
    harness.process(grant_control("second")).expect("re-grants");
    // Then: the stale generation admits nothing, the fresh one does.
    assert!(!harness.queued_admits_foreground(stale));
    let frame = harness.capture("101");
    let reply = harness.process(click_window(&frame, delivery("foreground")));
    assert!(reply.is_ok(), "{reply:?}");
}

#[test]
fn ax_click_foreground_needs_the_grant() {
    let _lock = test_lock().lock();
    // Given
    let mut harness = harness(&two_windows());
    let reference = harness.focused_ref();
    let click = crate::request::Op::AxClick(senpi_desktop_core::protocol_params::AxClickParams {
        ref_: reference,
        opts: delivery("foreground"),
    });
    // When
    let reply = harness.process(click);
    // Then
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::ControlRequired));
    assert_eq!(harness.sink.ops(), Vec::new());
}

fn raise(id: &str) -> crate::request::Op {
    crate::request::Op::RaiseWindow(senpi_desktop_core::protocol_params::RaiseWindowParams {
        window_id: id.to_owned(),
    })
}

#[test]
fn raising_a_window_without_a_grant_is_refused_and_says_how_to_allow_it() {
    let _lock = test_lock().lock();
    // Given: nobody granted foreground control (the host never got an answer)
    let mut harness = harness(&two_windows());
    // When
    let reply = harness.process(raise("101"));
    // Then: refused before any backend call, and the message names the grant
    let error = reply.expect_err("raise needs the grant");
    assert_eq!(error.code, ErrorCode::ControlRequired);
    assert!(
        error.message.contains("raising a window takes your foreground"),
        "{}",
        error.message
    );
    assert_eq!(harness.sink.ops(), Vec::new());
}

#[test]
fn raising_a_window_with_a_live_grant_is_admitted() {
    let _lock = test_lock().lock();
    // Given
    let mut harness = harness(&two_windows());
    harness.process(grant_control("raise")).expect("grants");
    // When
    let reply = harness.process(raise("101"));
    // Then
    assert!(reply.is_ok(), "{reply:?}");
    assert!(!harness.sink.ops().is_empty());
}

#[test]
fn an_op_admitted_under_the_old_generation_still_finishes_its_transaction() {
    let _lock = test_lock().lock();
    // Given: the grant is revoked from another thread mid-transaction.
    let mut harness = harness(&two_windows());
    let supervisor = Arc::clone(&harness.supervisor);
    harness.process(grant_control("one")).expect("grants");
    // When: a stop lands while the action runs; the op finishes and restores
    let result = harness
        .worker
        .mutate(&foreground_click_mutation(), &|| false, move |worker| {
            supervisor.trigger_stop(StopSource::Hotkey);
            granted_foreground_click(harness)(worker)
        })
        .map(|((), _audit)| ());
    // Then: suspended, but capture, input, release and restore all happened
    assert_eq!(result.map_err(|error| error.code), Err(ErrorCode::Suspended));
    assert_eq!(
        op_names(&harness),
        ["front", "pointer", "release", "restore-front", "warp"]
    );
}
