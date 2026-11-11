//! The machine-wide interaction lock around a transaction: a foreground
//! transaction, or background keys that hand key focus back, holds it from
//! the capture through the restore, other background exec only around the
//! dispatch (and its release on failure), and a lock another process holds
//! refuses the request before any input.

use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_backend_fake::FakeMethod;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::protocol_params::TypeTextParams;

use crate::grant::ControlSlot;
use crate::lock::InteractionLock;
use crate::request::Op;
use crate::test_support::{click_window, delivery, grant_control, harness_with_slot, op_names, two_windows, Harness};

/// Each take (`true`) and release (`false`) with the sink's op count then.
type Seen = Arc<Mutex<Vec<(bool, usize)>>>;

fn observed(dir: &std::path::Path) -> (Harness, Seen) {
    let slot = ControlSlot::with_lock_dir(dir.to_owned());
    let harness = harness_with_slot(&two_windows(), Arc::clone(&slot));
    let seen = Seen::default();
    let (sink, record) = (harness.sink.clone(), Arc::clone(&seen));
    *slot.interaction().observer.lock() = Some(Arc::new(move |taken| record.lock().push((taken, sink.ops().len()))));
    (harness, seen)
}

#[test]
fn a_foreground_transaction_holds_the_lock_from_capture_through_restore() {
    // Given
    let dir = tempfile::tempdir().expect("temp dir");
    let (mut harness, seen) = observed(dir.path());
    let frame = harness.capture("101");
    harness.process(grant_control("watching")).expect("grants");
    // When
    let reply = harness.process(click_window(&frame, delivery("foreground")));
    // Then: taken before the front-window capture, released after the cursor restore
    assert!(reply.is_ok(), "{reply:?}");
    assert_eq!(op_names(&harness), ["front", "pointer", "restore-front", "warp"]);
    assert_eq!(*seen.lock(), [(true, 0), (false, 4)]);
}

#[test]
fn background_exec_holds_the_lock_only_around_the_dispatch() {
    // Given
    let dir = tempfile::tempdir().expect("temp dir");
    let (mut harness, seen) = observed(dir.path());
    let frame = harness.capture("101");
    // When
    let reply = harness.process(click_window(&frame, None));
    // Then
    assert!(reply.is_ok(), "{reply:?}");
    assert_eq!(op_names(&harness), ["pointer"]);
    assert_eq!(*seen.lock(), [(true, 0), (false, 1)]);
}

#[test]
fn a_background_key_transaction_holds_the_lock_from_focus_capture_through_its_hand_back() {
    // Given
    let dir = tempfile::tempdir().expect("temp dir");
    let (mut harness, seen) = observed(dir.path());
    // When: background typing captures the front window and hands key focus back
    let reply = harness.process(Op::TypeText(TypeTextParams {
        target: "101".to_owned(),
        text: "hi".to_owned(),
        opts: None,
    }));
    // Then: taken before the capture, released after the hand-back
    assert!(reply.is_ok(), "{reply:?}");
    let names = op_names(&harness);
    assert_eq!(names.first(), Some(&"front"), "{names:?}");
    assert_eq!(names.last(), Some(&"restore-key-focus"), "{names:?}");
    assert_eq!(*seen.lock(), [(true, 0), (false, names.len())]);
}

#[test]
fn a_failed_background_dispatch_releases_held_input_before_the_lock() {
    // Given
    let dir = tempfile::tempdir().expect("temp dir");
    let (mut harness, seen) = observed(dir.path());
    let frame = harness.capture("101");
    harness.faults.fail_next(FakeMethod::Click, ErrorCode::InputFailed);
    // When
    let reply = harness.process(click_window(&frame, None));
    // Then: the release is sent while the dispatch still holds the lock
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::InputFailed));
    let names = op_names(&harness);
    assert_eq!(names.last(), Some(&"release"), "{names:?}");
    assert_eq!(*seen.lock(), [(true, 0), (false, names.len())]);
}

#[test]
fn a_lock_held_by_another_process_refuses_input_busy_then_the_retry_proceeds() {
    // Given: another engine process holds the lock
    let dir = tempfile::tempdir().expect("temp dir");
    let (mut harness, _seen) = observed(dir.path());
    let frame = harness.capture("101");
    let other = InteractionLock::at(dir.path().to_owned());
    let held = other.acquire(false, &|| None).expect("free");
    // When
    let busy = harness.process(click_window(&frame, None));
    // Then: nothing was sent, and the refusal is audited
    assert_eq!(busy.map_err(|error| error.code), Err(ErrorCode::InputBusy));
    assert!(!op_names(&harness).contains(&"pointer"), "{:?}", op_names(&harness));
    let audited: Vec<_> = harness.audits().into_iter().map(|audit| audit.code).collect();
    assert_eq!(audited, [Some(ErrorCode::InputBusy)]);
    // When: the other process is done
    drop(held);
    let retried = harness.process(click_window(&frame, None));
    // Then
    assert!(retried.is_ok(), "{retried:?}");
    assert!(op_names(&harness).contains(&"pointer"));
}

#[test]
fn an_unusable_lock_directory_sends_no_input() {
    // Given
    let dir = tempfile::tempdir().expect("temp dir");
    let blocked = dir.path().join("file");
    std::fs::write(&blocked, b"").expect("file");
    let (mut harness, _seen) = observed(&blocked);
    let frame = harness.capture("101");
    // When
    let reply = harness.process(click_window(&frame, None));
    // Then
    assert_eq!(reply.map_err(|error| error.code), Err(ErrorCode::TransactionFailed));
    assert!(!op_names(&harness).contains(&"pointer"));
}
