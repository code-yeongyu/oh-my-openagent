//! Gate review a4: a fallible step the funnel survives fail-closed is still logged, never
//! dropped. The crash path's poison record above all: when it cannot be written the marker is
//! kept (every other callId of the scope reads `recovery_required`) and the log says why.

use std::fs;

use omo_computer_core::report::Disposition;

use super::recovery::die_after_input;
use super::swallowed::{FailingAppend, FailingClear};
use super::{click, wire, Run};
use crate::lock::InteractionLock;
use crate::mutate::poison::Poisoned;
use crate::Session;

fn warned(session: &Session, needle: &str) -> bool {
    session
        .funnel
        .warned
        .iter()
        .any(|line| line.contains(needle))
}

#[test]
fn a_crashed_call_that_cannot_be_poison_recorded_is_logged_and_keeps_its_marker() {
    let run = Run::new();
    die_after_input(&run, "c-crash", 1);
    let blocked = run.dir.path().join("not-a-dir");
    fs::write(&blocked, b"a file where the poison records go").expect("file");
    let mut session = run.session(Box::new(run.fake()));
    session.funnel.poisoned = Poisoned::Dir(blocked);
    let redrive = session
        .click(click("c-crash"))
        .expect_err("the re-drive is refused");
    assert_eq!(redrive.interrupted, Some(Disposition::UNCERTAIN_UNSAFE));
    assert!(
        session
            .funnel
            .warned
            .iter()
            .any(|line| line.contains("not poison-recorded")),
        "{:?}",
        session.funnel.warned
    );
    assert!(
        run.marker_file().exists(),
        "fail-closed: the marker is kept"
    );
    assert_eq!(run.sink.len(), 3, "nothing was resent");
}

#[test]
fn a_completed_marker_that_cannot_be_cleared_is_logged() {
    let run = Run::new();
    let mut session = run.session(Box::new(run.fake()));
    session.funnel.markers = Box::new(FailingClear::default());
    session.click(click("c-first")).expect("delivered");
    let next = session
        .click(click("c-next"))
        .expect_err("the completed marker could not be cleared");
    assert_eq!(
        wire(&next),
        ("TransactionFailed", Some("marker_unavailable"))
    );
    assert!(
        warned(&session, "completed marker not cleared"),
        "{:?}",
        session.funnel.warned
    );
}

#[test]
fn an_interaction_lock_that_cannot_be_taken_is_logged_and_sends_nothing() {
    let run = Run::new();
    let blocked = run.dir.path().join("not-a-dir");
    fs::write(&blocked, b"a file where the lock dir goes").expect("file");
    let mut session = run.session(Box::new(run.fake()));
    session.funnel.lock = Some(InteractionLock::under(&blocked));
    let refused = session.click(click("c-lock")).expect_err("no lock");
    assert_eq!(wire(&refused), ("TransactionFailed", None));
    assert!(
        warned(&session, "interaction lock not taken"),
        "{:?}",
        session.funnel.warned
    );
    assert!(run.sink.is_empty(), "nothing sent");
}

#[test]
fn an_audit_file_that_cannot_be_opened_is_logged() {
    let run = Run::new();
    fs::write(
        run.dir.path().join("audit"),
        b"a file where the audit dir goes",
    )
    .expect("file");
    let mut session = run.session(Box::new(run.fake()));
    let refused = session
        .click(click("c-audit"))
        .expect_err("audit unavailable");
    assert_eq!(wire(&refused), ("Internal", Some("audit_unavailable")));
    assert!(
        warned(&session, "audit file not opened"),
        "{:?}",
        session.funnel.warned
    );
}

#[test]
fn a_failed_audit_append_after_a_delivered_call_is_logged() {
    let run = Run::new();
    let mut session = run.session(Box::new(run.fake()));
    session.funnel.audit = Some(Box::new(FailingAppend));
    session.click(click("c-ok")).expect("delivered");
    assert!(
        warned(&session, "audit line not written"),
        "{:?}",
        session.funnel.warned
    );
}

#[test]
fn a_marker_that_cannot_be_written_is_logged_and_sends_nothing() {
    let run = Run::new();
    fs::write(
        run.dir.path().join("markers"),
        b"a file where the markers dir goes",
    )
    .expect("file");
    let mut session = run.session(Box::new(run.fake()));
    let refused = session.click(click("c-marker")).expect_err("no marker");
    assert_eq!(
        wire(&refused),
        ("TransactionFailed", Some("marker_unavailable"))
    );
    assert!(
        warned(&session, "marker not written"),
        "{:?}",
        session.funnel.warned
    );
    assert!(run.sink.is_empty(), "nothing sent");
}

/// Gate review a6: the in-process grep-zero walk (`Run::everything_written`) must fail on a
/// file it cannot read, never skip it (a skipped file would read as clean). A dangling
/// symlink is unreadable without any permission trick (ENOENT), so this holds as root too.
#[cfg(unix)]
#[test]
fn the_grep_zero_walk_fails_on_a_file_it_cannot_read() {
    let run = Run::new();
    std::os::unix::fs::symlink(
        run.dir.path().join("nowhere"),
        run.dir.path().join("dangling"),
    )
    .expect("a dangling symlink");
    let walked =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run.everything_written()));
    assert!(
        walked.is_err(),
        "an unreadable file must fail the walk, not be skipped"
    );
}

/// Review L3 of #13370 (at c72fac7d86, ruling R70bg): the admission runs again after the
/// interaction lock is held. A second holder keeps the lock while a stop is pressed after the
/// session's admission ran; when the lock comes free the waiting exec is refused `Suspended`,
/// nothing sent, and the lock is released.
#[test]
fn a_stop_pressed_while_another_holder_keeps_the_lock_refuses_the_waiting_exec() {
    let run = Run::new();
    let fake = run.fake();
    let remote = fake.handle();
    let clock = fake.clock();
    let mut session = run.session(Box::new(fake));
    let other = InteractionLock::under(run.dir.path());
    let held = other.acquire().expect("the other holder takes the lock");
    let before = remote.stop_polls();
    // Driven on the fake clock (review M1 of #13767): the exec's wait advances it, and on the
    // first advance after the session's admission polled the listener, the stop is pressed and
    // only then the lock released. No thread, no timing.
    // The hook acts only when time moved: the fake's own zero-length advances run under its
    // state lock, where reading the remote would deadlock; the exec's wait moves time unlocked.
    let release = std::sync::Mutex::new(Some(held));
    let last = std::sync::atomic::AtomicU64::new(clock.now_ms());
    clock.on_advance(Box::new(move |now| {
        if last.swap(now, std::sync::atomic::Ordering::SeqCst) == now {
            return;
        }
        if remote.stop_polls() > before {
            if let Some(held) = release.lock().expect("hook").take() {
                remote.press_stop_chord();
                drop(held);
            }
        }
    }));
    let refused = session
        .click(click("c-locked"))
        .expect_err("the stop pressed while waiting refuses");
    assert_eq!(wire(&refused).0, "Suspended");
    assert!(run.sink.is_empty(), "nothing sent: {:?}", run.sink.lines());
    assert!(
        other.try_acquire().expect("try").is_some(),
        "the refused exec released the lock"
    );
}
