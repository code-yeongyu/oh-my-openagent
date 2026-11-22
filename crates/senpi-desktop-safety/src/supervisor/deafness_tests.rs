//! A deaf global listener refuses input at the very next status read, and a
//! dead one is never reported as deaf.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::{FakeClock, StopPathFailure, StopPathId, StopPathReason, StopPolicy, Supervisor};

const GLOBAL_ONLY: StopPolicy = StopPolicy {
    allow_host_relay_only: false,
};

fn live_supervisor(deaf: &Arc<AtomicBool>) -> Supervisor {
    let supervisor = Supervisor::new(Arc::new(FakeClock::new(1_000)));
    let deaf = Arc::clone(deaf);
    supervisor.set_deaf_probe(Some(Arc::new(move || {
        deaf.load(Ordering::SeqCst).then_some(StopPathFailure::SecureInput)
    })));
    supervisor.set_live(StopPathId::Global, true);
    supervisor
}

#[test]
fn a_deaf_listener_refuses_input_without_waiting_for_a_heartbeat() {
    // given: a live, fresh global path that can hear the chord
    let deaf = Arc::new(AtomicBool::new(false));
    let supervisor = live_supervisor(&deaf);
    assert!(supervisor.input_allowed(&GLOBAL_ONLY));

    // when: it goes deaf, with no heartbeat or clock step in between
    deaf.store(true, Ordering::SeqCst);

    // then: input is refused at once with the deafness reason, and no stop latches
    let status = supervisor.status();
    assert!(!supervisor.input_allowed(&GLOBAL_ONLY));
    assert!(!status.global_live);
    assert_eq!(
        status.stop_path_unavailable(&GLOBAL_ONLY),
        Some(StopPathReason::SecureInputActive)
    );
    assert!(!supervisor.is_suspended());

    // when / then: hearing again authorizes input again
    deaf.store(false, Ordering::SeqCst);
    assert!(supervisor.input_allowed(&GLOBAL_ONLY));
}

#[test]
fn a_dead_listener_is_never_reported_as_deaf() {
    // given: a deaf probe on a path that then dies
    let deaf = Arc::new(AtomicBool::new(true));
    let supervisor = live_supervisor(&deaf);

    // when
    supervisor.set_live(StopPathId::Global, false);

    // then
    assert_eq!(
        supervisor.status().stop_path_unavailable(&GLOBAL_ONLY),
        Some(StopPathReason::NoGlobalListener)
    );
}

#[test]
fn a_deaf_listener_under_the_relay_only_policy_reports_the_cause() {
    // given: only the global path is deaf; the host relay is not armed
    let deaf = Arc::new(AtomicBool::new(true));
    let supervisor = live_supervisor(&deaf);

    // then: the reason names the cause even when relay-only is allowed
    let relay_only = StopPolicy {
        allow_host_relay_only: true,
    };
    assert_eq!(
        supervisor.status().stop_path_unavailable(&relay_only),
        Some(StopPathReason::SecureInputActive)
    );
}
