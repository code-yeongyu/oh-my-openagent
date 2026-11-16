//! A-IS-66 (binding; a regression fix against the shipped engine): the interaction lock's wait is
//! bounded at 2,000 ms and a stop ends it. Time runs on the fake backend's clock (the engine's
//! clock seam), so nothing here sleeps; the holder is a second handle on the same lock file, which
//! the OS lock excludes exactly as it excludes another process.

use std::fs;

use super::{click, wire, Run};
use crate::lock::InteractionLock;

fn holder(run: &Run) -> crate::lock::LockGuard {
    InteractionLock::under(run.dir.path()).acquire().expect("another engine holds the lock")
}

/// TW1: refused InputBusy{interaction_lock} only after the budget, with waitedMs and
/// retryAfterMs, nothing sent, and its audit line written (stage Lease).
#[test]
fn tw1_a_second_caller_is_refused_input_busy_after_the_wait_budget_with_nothing_sent() {
    let run = Run::new();
    let mut session = run.session(Box::new(run.fake()));
    let held = holder(&run);
    let refused = session.click(click("c-busy")).expect_err("the lock stays held");
    assert_eq!(wire(&refused), ("InputBusy", Some("interaction_lock")));
    let detail = refused.detail.as_deref().cloned().unwrap_or_default();
    assert!(detail["waitedMs"].as_u64().is_some_and(|waited| waited >= 2_000), "{detail}");
    assert_eq!(detail["retryAfterMs"], 2_000, "{detail}");
    assert!(run.sink.is_empty(), "nothing sent");
    let line = run.audit_lines().into_iter().find(|line| line["callId"] == "c-busy").expect("its audit line");
    assert_eq!(line["gate"]["code"], "InputBusy", "{line}");
    assert_eq!(line["gate"]["reason"], "interaction_lock", "{line}");
    assert_eq!(line["gate"]["stage"], "Lease", "{line}");
    drop(held);
}

/// TW4: at the bound the lock file, the holder and the holder's lock are unaffected.
#[test]
fn tw4_the_bound_leaves_the_lock_file_and_its_holder_alone() {
    let run = Run::new();
    let mut session = run.session(Box::new(run.fake()));
    let held = holder(&run);
    let path = InteractionLock::under(run.dir.path()).path().to_owned();
    let before = fs::metadata(&path).expect("the lock file");
    let _refused = session.click(click("c-busy")).expect_err("busy");
    let after = fs::metadata(&path).expect("the same lock file");
    assert_eq!((before.len(), before.modified().ok()), (after.len(), after.modified().ok()));
    assert!(InteractionLock::under(run.dir.path()).try_acquire().expect("probe").is_none(), "still held");
    drop(held);
    assert!(InteractionLock::under(run.dir.path()).try_acquire().expect("probe").is_some(), "free after");
}

/// TW3: the holder releases during the wait: the waiter takes the lock, re-admits and sends.
#[test]
fn tw3_a_lock_released_during_the_wait_is_taken_and_the_call_sends() {
    let run = Run::new();
    let fake = run.fake();
    let clock = fake.clock();
    let mut session = run.session(Box::new(fake));
    let held = std::sync::Arc::new(std::sync::Mutex::new(Some(holder(&run))));
    let release = held.clone();
    clock.on_advance(Box::new(move |now| {
        if now >= 500 {
            release.lock().expect("holder").take();
        }
    }));
    session.click(click("c-later")).expect("sent once the holder let go");
    assert!(!run.sink.is_empty(), "sent");
}

/// TW2 (in-process latch and a marker written by another process): a stop during the wait ends
/// it before the budget with the stop's own refusal; nothing sent.
#[test]
fn tw2_a_stop_marker_committed_during_the_wait_ends_it_with_the_stops_refusal() {
    let run = Run::new();
    let fake = run.fake();
    let clock = fake.clock();
    let mut session = run.session(Box::new(fake));
    let held = holder(&run);
    let marker = run.dir.path().join(omo_computer_core::paths::STOP_MARKER_FILE);
    clock.on_advance(Box::new(move |now| {
        if now >= 300 && !marker.exists() {
            use omo_computer_safety::marker::MarkerStore;
            let mut other = omo_computer_safety::marker::FileMarker::at(marker.clone());
            other.commit().expect("another engine stops");
        }
    }));
    let refused = session.click(click("c-stop")).expect_err("stopped");
    assert_eq!(refused.refusal.code.wire(), "Suspended");
    assert!(run.sink.is_empty(), "nothing sent");
    drop(held);
}

/// Review L1 of #13767 (at 43d7da90ec): a stop marker another engine commits while this exec
/// waits latches this engine's stop, as the marker read at engine start does: once the holder
/// lets go, the session's next exec is refused too, never sent.
#[test]
fn tw2b_a_stop_marker_seen_during_the_wait_stays_latched_for_the_next_call() {
    let run = Run::new();
    let fake = run.fake();
    let clock = fake.clock();
    let mut session = run.session(Box::new(fake));
    let held = holder(&run);
    let marker = run.dir.path().join(omo_computer_core::paths::STOP_MARKER_FILE);
    clock.on_advance(Box::new(move |_| {
        if !marker.exists() {
            use omo_computer_safety::marker::MarkerStore;
            let mut other = omo_computer_safety::marker::FileMarker::at(marker.clone());
            other.commit().expect("another engine stops");
        }
    }));
    let first = session.click(click("c-stop-1")).expect_err("stopped while waiting");
    assert_eq!(first.refusal.code.wire(), "Suspended");
    drop(held);
    let next = session.click(click("c-stop-2")).expect_err("the stop stays latched");
    assert_eq!(next.refusal.code.wire(), "Suspended", "{next:?}");
    assert!(run.sink.is_empty(), "nothing sent: {:?}", run.sink.lines());
}

/// TW6: an unusable lock refuses as A-IS-65 L2 (TransactionFailed), never InputBusy.
#[test]
fn tw6_an_unusable_lock_is_transaction_failed_never_input_busy() {
    let run = Run::new();
    let blocked = run.dir.path().join("not-a-dir");
    fs::write(&blocked, b"a file where the lock dir goes").expect("file");
    let mut session = run.session(Box::new(run.fake()));
    session.funnel.lock = Some(InteractionLock::under(&blocked));
    let refused = session.click(click("c-unusable")).expect_err("no lock");
    assert_eq!(wire(&refused), ("TransactionFailed", None));
    assert!(run.sink.is_empty());
}

/// TW9: acceptance 6's C4 enumeration includes (InputBusy, interaction_lock) with its SDK row.
#[test]
fn tw9_the_error_map_has_the_interaction_lock_row() {
    use omo_computer_core::error::{lookup, EngineCode, FailureKey, Reason, Source};
    let row = lookup(FailureKey { source: Source::Engine(EngineCode::InputBusy), reason: Some(Reason::InteractionLock) })
        .expect("the row");
    assert_eq!(row.computer.wire(), "COMPUTER_INPUT_BUSY");
}
