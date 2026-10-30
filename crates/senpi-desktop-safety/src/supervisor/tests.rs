use std::sync::Arc;

use super::{
    ActiveStopPath, StopPathId, StopPolicy, StopSource, Supervisor, HEARTBEAT_FRESH_MS, HEARTBEAT_INTERVAL_MS,
};
use crate::{clock::FakeClock, reset::ResumeToken};

const GLOBAL_ONLY: StopPolicy = StopPolicy {
    allow_host_relay_only: false,
};
const HOST_RELAY_ALLOWED: StopPolicy = StopPolicy {
    allow_host_relay_only: true,
};

fn supervisor_at(start_ms: u64) -> (Supervisor, Arc<FakeClock>) {
    let clock = Arc::new(FakeClock::new(start_ms));
    (Supervisor::new(clock.clone()), clock)
}

#[test]
fn fresh_supervisor_disallows_input_until_stop_path_is_live() {
    // Given: a supervisor no stop path has registered with
    let (supervisor, _clock) = supervisor_at(1_000);

    // When: the status is read
    let status = supervisor.status();

    // Then: input is refused without being a suspension
    assert!(!status.input_allowed(&HOST_RELAY_ALLOWED), "not live yet");
    assert!(!status.suspended);
    assert_eq!(status.stop_path, ActiveStopPath::None);
}

#[test]
fn live_and_fresh_allows_input() {
    // Given: a live global stop path
    let (supervisor, clock) = supervisor_at(10_000);
    supervisor.set_live(StopPathId::Global, true);

    // When: one heartbeat interval passes
    clock.advance(HEARTBEAT_INTERVAL_MS);

    // Then: input is allowed through the global stop path
    assert!(supervisor.input_allowed(&GLOBAL_ONLY));
    assert_eq!(supervisor.status().stop_path, ActiveStopPath::Global);
}

#[test]
fn stale_heartbeat_disables_input() {
    // Given: a live global stop path that last beat at t=10_000
    let (supervisor, clock) = supervisor_at(10_000);
    supervisor.set_live(StopPathId::Global, true);

    // When: the heartbeat window elapses by one millisecond
    clock.advance(HEARTBEAT_FRESH_MS + 1);

    // Then: input fails closed, yet the supervisor is not suspended
    let status = supervisor.status();
    assert!(
        !status.input_allowed(&GLOBAL_ONLY),
        "stale heartbeat must fail closed"
    );
    assert!(!status.heartbeat_fresh);
    assert!(!status.suspended, "stale != suspended");
}

#[test]
fn heartbeat_keeps_the_stop_path_fresh() {
    // Given: a live global stop path about to go stale
    let (supervisor, clock) = supervisor_at(10_000);
    supervisor.set_live(StopPathId::Global, true);
    clock.advance(HEARTBEAT_FRESH_MS);

    // When: it beats and another full window passes
    supervisor.heartbeat(StopPathId::Global);
    clock.advance(HEARTBEAT_FRESH_MS);

    // Then: the freshness window restarted at the beat
    assert!(supervisor.input_allowed(&GLOBAL_ONLY));
}

#[test]
fn host_relay_only_requires_policy_opt_in() {
    // Given: only the host relay is live and fresh
    let (supervisor, clock) = supervisor_at(10_000);
    supervisor.set_live(StopPathId::HostRelay, true);
    clock.advance(HEARTBEAT_INTERVAL_MS);

    // When: the status is read
    let status = supervisor.status();

    // Then: input needs the allowHostRelayOnlyStop opt-in
    assert_eq!(status.stop_path, ActiveStopPath::HostRelay);
    assert!(status.heartbeat_fresh);
    assert!(!status.input_allowed(&GLOBAL_ONLY));
    assert!(status.input_allowed(&HOST_RELAY_ALLOWED));
}

#[test]
fn fresh_host_relay_covers_a_stale_global_listener_only_with_opt_in() {
    // Given: a global listener gone stale while the host relay keeps beating
    let (supervisor, clock) = supervisor_at(10_000);
    supervisor.set_live(StopPathId::Global, true);
    supervisor.set_live(StopPathId::HostRelay, true);
    clock.advance(HEARTBEAT_FRESH_MS + 1);

    // When: the host relay beats
    supervisor.heartbeat(StopPathId::HostRelay);

    // Then: the relay is the active path and the policy decides
    let status = supervisor.status();
    assert_eq!(status.stop_path, ActiveStopPath::HostRelay);
    assert!(status.global_live && status.host_relay_live);
    assert!(!status.input_allowed(&GLOBAL_ONLY));
    assert!(status.input_allowed(&HOST_RELAY_ALLOWED));
}

#[test]
fn losing_stop_path_liveness_disables_input() {
    // Given: a live, fresh global stop path
    let (supervisor, _clock) = supervisor_at(10_000);
    supervisor.set_live(StopPathId::Global, true);

    // When: the listener reports itself dead
    supervisor.set_live(StopPathId::Global, false);

    // Then: input fails closed even though the last beat is fresh
    assert!(
        !supervisor.input_allowed(&HOST_RELAY_ALLOWED),
        "dead stop path must fail closed"
    );
    assert_eq!(supervisor.status().stop_path, ActiveStopPath::None);
}

#[test]
fn trigger_stop_latches_until_user_reset() {
    // Given: a suspended supervisor whose stop path stays live and fresh
    let (supervisor, clock) = supervisor_at(10_000);
    supervisor.set_live(StopPathId::Global, true);
    supervisor.trigger_stop(StopSource::Hotkey);
    supervisor.trigger_stop(StopSource::Api);
    clock.advance(HEARTBEAT_INTERVAL_MS);
    supervisor.heartbeat(StopPathId::Global);
    let latched = supervisor.status();

    // When: the user redeems the resume token
    let proof = ResumeToken::new("resume-secret".to_owned()).redeem("resume-secret");
    supervisor.reset(proof.expect("the matching token redeems"));

    // Then: the latch held with its first source, and reset lifts it
    assert!(!latched.input_allowed(&GLOBAL_ONLY));
    assert_eq!(latched.stopped_by, Some(StopSource::Hotkey));
    let resumed = supervisor.status();
    assert!(!resumed.suspended);
    assert_eq!(resumed.stopped_by, None);
    assert!(resumed.input_allowed(&GLOBAL_ONLY));
}

#[test]
fn mismatched_resume_token_yields_no_reset_proof() {
    // Given: the engine's resume token
    let token = ResumeToken::new("resume-secret".to_owned());

    // When: a caller presents a different token
    let proof = token.redeem("guessed");

    // Then: no UserReset exists to lift suspension with
    assert!(proof.is_none());
}
