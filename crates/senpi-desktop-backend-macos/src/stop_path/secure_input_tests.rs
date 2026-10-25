//! Secure Event Input hides key events from every event tap: while it is on,
//! the tap is enabled and beating but deaf, so it must not authorize input.

use std::cell::Cell;
use std::sync::Arc;

use senpi_desktop_safety::{Chord, FakeClock, StopPathFailure, StopPathReason, StopPolicy, Supervisor};

use super::chord::{Hotkey, DEFAULT_STOP_CHORD};
use super::Shared;

const GLOBAL_ONLY: StopPolicy = StopPolicy {
    allow_host_relay_only: false,
};

thread_local! {
    /// What the injected `IsSecureEventInputEnabled` reports on this thread.
    static SECURE_INPUT: Cell<bool> = const { Cell::new(false) };
}

fn secure_input() -> bool {
    SECURE_INPUT.with(Cell::get)
}

/// Sets the injected secure-input state and restores it on drop, so a
/// failing assertion never leaks it into the next test on this thread.
struct SecureInput;

impl SecureInput {
    fn set(on: bool) -> Self {
        SECURE_INPUT.with(|secure| secure.set(on));
        Self
    }

    fn turn(&self, on: bool) {
        SECURE_INPUT.with(|secure| secure.set(on));
    }
}

impl Drop for SecureInput {
    fn drop(&mut self) {
        SECURE_INPUT.with(|secure| secure.set(false));
    }
}

/// A listener wired the way `start()` wires it: its probe registered.
fn shared() -> Shared {
    let supervisor = Arc::new(Supervisor::new(Arc::new(FakeClock::new(1_000))));
    let hotkey = Hotkey::parse(&Chord::parse(DEFAULT_STOP_CHORD).unwrap()).unwrap();
    let shared = Shared::with_secure_input(supervisor, hotkey, secure_input).unwrap();
    shared.supervisor.set_deaf_probe(Some(shared.deaf_probe()));
    shared
}

#[test]
fn secure_input_refuses_input_at_once_and_lifts_by_itself() {
    // given: a live tap that can hear the chord
    let secure = SecureInput::set(false);
    let shared = shared();
    shared.set_live(true);
    assert!(shared.supervisor.input_allowed(&GLOBAL_ONLY));

    // when: another process turns Secure Event Input on, with no heartbeat in between
    secure.turn(true);

    // then: the very next status refuses input, names the cause, and latches nothing
    let status = shared.supervisor.status();
    assert!(
        !shared.supervisor.input_allowed(&GLOBAL_ONLY),
        "input ran while the stop chord was deaf"
    );
    assert_eq!(
        status.stop_path_unavailable(&GLOBAL_ONLY),
        Some(StopPathReason::SecureInputActive)
    );
    assert_eq!(status.global_failure, Some(StopPathFailure::SecureInput));
    assert!(!shared.supervisor.is_suspended());
    assert!(shared.control.lock().live, "the tap itself is still up and must not be re-created");

    // when: secure input ends
    secure.turn(false);

    // then: the path authorizes input again by itself
    assert!(shared.supervisor.input_allowed(&GLOBAL_ONLY));
    assert_eq!(shared.supervisor.status().global_failure, None);
}

#[test]
fn a_tap_that_comes_up_under_secure_input_never_authorizes_input() {
    // given: secure input is already on when the tap goes live
    let _secure = SecureInput::set(true);
    let shared = shared();

    // when
    shared.set_live(true);

    // then
    assert!(!shared.supervisor.input_allowed(&GLOBAL_ONLY));
    assert_eq!(
        shared.supervisor.status().stop_path_unavailable(&GLOBAL_ONLY),
        Some(StopPathReason::SecureInputActive)
    );
}

#[test]
fn a_tap_that_dies_under_secure_input_reports_the_dead_listener_not_secure_input() {
    // given: a live tap under secure input
    let _secure = SecureInput::set(true);
    let shared = shared();
    shared.set_live(true);

    // when: the tap dies and does not come back
    shared.tap_failed();

    // then: the reason names the dead listener, not the password field
    assert_eq!(
        shared.supervisor.status().stop_path_unavailable(&GLOBAL_ONLY),
        Some(StopPathReason::NoGlobalListener)
    );
}
