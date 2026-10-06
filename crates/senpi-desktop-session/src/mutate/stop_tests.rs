//! gajae `executor.rs` stop, cancellation, and admission tests, ported onto
//! `mutate()`. A backend sends a key chord as one call, so a stop that lands
//! "between keys" is observed after the final key.

use std::cell::Cell;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use senpi_desktop_backend_fake::SinkOp;
use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::keys::parse_keys;
use senpi_desktop_core::protocol_params::{KeyChordParams, TypeTextParams};
use senpi_desktop_core::types::Target;
use senpi_desktop_safety::{
    FakeClock, GateError, MutatingAction, StopPathId, StopPathReason, StopSource, Supervisor,
    HEARTBEAT_FRESH_MS,
};
use serde_json::json;

use super::{Mutation, INPUT_TRANSACTION};
use crate::request::{Op, Response};
use crate::test_support::{delivery, foreground_click_mutation, harness, op_names, two_windows, Harness};
use crate::worker::Worker;

const HANG_GUARD: Duration = Duration::from_secs(30);

fn chord_mutation() -> Mutation<'static> {
    Mutation::new(
        MutatingAction::KeyChord,
        "101".to_owned(),
        DeliveryMode::Background,
    )
}

fn press(worker: &mut Worker, keys: &[&str]) -> CoreResult<()> {
    let keys = parse_keys(&keys.iter().map(|key| (*key).to_owned()).collect::<Vec<_>>())?;
    let target = Target::Window("101".to_owned());
    worker
        .backend()?
        .key_chord(&target, &keys, DeliveryMode::Background)
}

fn chord_op(keys: &[&str], mode: &str) -> Op {
    Op::KeyChord(KeyChordParams {
        target: "101".to_owned(),
        keys: keys.iter().map(|key| (*key).to_owned()).collect(),
        opts: delivery(mode),
    })
}

/// gajae `assert_keypress_stop`: `stop` lands while the chord is sent, and
/// the cancellation probe follows suspension, as in gajae.
fn assert_chord_stop(keys: &[&str], stop: fn(&Supervisor, &FakeClock), expected: GateError) {
    // Given
    let mut harness = harness(&json!({}));
    let (supervisor, clock) = (Arc::clone(&harness.supervisor), Arc::clone(&harness.clock));
    // When
    let result = harness
        .worker
        .mutate(&chord_mutation(), &|| supervisor.is_suspended(), |worker| {
            stop(&supervisor, &clock);
            press(worker, keys)
        })
        .map(|((), _audit)| ());
    // Then: the chord was sent once, then released, then key focus restored.
    assert_eq!(result, Err(DesktopError::from(expected)));
    assert_eq!(
        op_names(&harness),
        ["front", "key", "release", "restore-key-focus"]
    );
}

#[test]
fn keypress_stops_when_hotkey_liveness_is_lost() {
    assert_chord_stop(
        &["enter", "tab"],
        |supervisor, _| supervisor.set_live(StopPathId::Global, false),
        GateError::StopPathUnavailable {
            reason: StopPathReason::NoGlobalListener,
        },
    );
}

#[test]
fn keypress_stops_when_heartbeat_becomes_stale() {
    assert_chord_stop(
        &["enter", "tab"],
        |_, clock| clock.advance(HEARTBEAT_FRESH_MS + 1),
        GateError::StopPathUnavailable {
            reason: StopPathReason::HeartbeatStale,
        },
    );
}

#[test]
fn keypress_suspension_precedes_liveness_and_cancellation() {
    assert_chord_stop(
        &["enter", "tab"],
        |supervisor, clock| {
            supervisor.trigger_stop(StopSource::Hotkey);
            supervisor.set_live(StopPathId::Global, false);
            clock.advance(HEARTBEAT_FRESH_MS + 1);
        },
        GateError::Suspended,
    );
}

#[test]
fn keypress_checks_liveness_after_the_final_key() {
    assert_chord_stop(
        &["enter"],
        |supervisor, _| supervisor.set_live(StopPathId::Global, false),
        GateError::StopPathUnavailable {
            reason: StopPathReason::NoGlobalListener,
        },
    );
}

#[test]
fn keypress_admission_race_preserves_suspension_before_the_first_key() {
    // Given: the cancellation probe races a stop.
    let mut harness = harness(&json!({}));
    let supervisor = Arc::clone(&harness.supervisor);
    let racing = || {
        supervisor.trigger_stop(StopSource::Api);
        true
    };
    // When
    let reply = harness
        .worker
        .process(chord_op(&["enter"], "background"), &racing);
    // Then
    assert_eq!(reply, Err(DesktopError::from(GateError::Suspended)));
    assert_eq!(harness.sink.ops(), Vec::new());
}

#[test]
fn non_key_actions_preserve_liveness_and_cancellation_semantics() {
    for cancelled in [false, true] {
        // Given: the stop path dies once the transaction has passed the gate
        // and captured the front window.
        let mut harness = harness(&json!({}));
        let (supervisor, sink) = (Arc::clone(&harness.supervisor), harness.sink.clone());
        let probe = || {
            let captured = sink.ops().contains(&SinkOp::QueryFrontWindow);
            if captured {
                supervisor.set_live(StopPathId::Global, false);
            }
            captured && cancelled
        };
        let op = Op::TypeText(TypeTextParams {
            target: "101".to_owned(),
            text: "ok".to_owned(),
            opts: None,
        });
        // When
        let reply = harness.worker.process(op, &probe);
        // Then: only cancellation stops typing; a dying stop path does not.
        let expected = if cancelled {
            Err(ErrorCode::Cancelled)
        } else {
            Ok(Response::Unit)
        };
        assert_eq!(reply.map_err(|error| error.code), expected);
        assert_eq!(op_names(&harness).contains(&"type"), !cancelled);
    }
}

#[test]
fn cancelled_before_transaction_admission_does_not_capture_or_restore() {
    // Given
    let mut harness = harness(&two_windows());
    // When
    let result = harness
        .worker
        .mutate(&foreground_click_mutation(), &|| true, |_| Ok(()))
        .map(|((), _audit)| ());
    // Then
    assert_eq!(result.map_err(|error| error.code), Err(ErrorCode::Cancelled));
    assert_eq!(harness.sink.ops(), Vec::new());
}

#[test]
fn mutex_admission_observes_cancellation_without_capturing_cursor() {
    // Given: another transaction holds the lock; the waiter cancels on its
    // third look.
    let mut harness = harness(&two_windows());
    let polls = Cell::new(0_u32);
    let cancel_on_third_poll = || {
        polls.set(polls.get() + 1);
        polls.get() >= 3
    };
    let (held_tx, held_rx) = flume::bounded::<()>(0);
    let (release_tx, release_rx) = flume::bounded::<()>(0);
    let holder = thread::spawn(move || {
        let _held = INPUT_TRANSACTION.lock();
        held_tx.send(()).unwrap_or(());
        // Hang guard: a waiter that ignores cancellation gets the lock after
        // 30 s and fails the assertions below instead of hanging the suite.
        release_rx.recv_timeout(HANG_GUARD).unwrap_or(());
    });
    held_rx.recv().expect("the holder took the lock");
    // When
    let result = harness
        .worker
        .mutate(&foreground_click_mutation(), &cancel_on_third_poll, |_| Ok(()))
        .map(|((), _audit)| ());
    // The holder may already have given up waiting.
    release_tx.send(()).unwrap_or(());
    holder.join().expect("the holder exits");
    // Then
    assert_eq!(result.map_err(|error| error.code), Err(ErrorCode::Cancelled));
    assert_eq!(harness.sink.ops(), Vec::new());
}

/// gajae `transaction_cancellation_during_{wait,keypress}_*`: there are no
/// batches or waits in a session request, so the window is between the
/// focus/cursor capture and the action.
#[test]
fn cancellation_after_capture_sends_no_input_and_restores_once() {
    let cases = [
        ("foreground", vec!["front", "release", "restore-front", "warp"]),
        ("background", vec!["front", "release", "restore-key-focus"]),
    ];
    for (mode, expected) in cases {
        // Given: the waiter gives up once the front window was captured.
        let mut harness: Harness = harness(&two_windows());
        let sink = harness.sink.clone();
        let captured = || sink.ops().contains(&SinkOp::QueryFrontWindow);
        // When
        let reply = harness
            .worker
            .process(chord_op(&["enter", "tab"], mode), &captured);
        // Then
        assert_eq!(
            reply.map_err(|error| error.code),
            Err(ErrorCode::Cancelled),
            "{mode}"
        );
        assert_eq!(op_names(&harness), expected, "{mode}");
    }
}
