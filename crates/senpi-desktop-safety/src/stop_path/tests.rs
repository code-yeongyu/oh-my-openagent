use std::sync::Arc;

use super::{Chord, HostRelay, StopPathError, StopPathListener};
use crate::clock::FakeClock;
use crate::supervisor::{ActiveStopPath, StopPolicy, Supervisor, HEARTBEAT_FRESH_MS, HEARTBEAT_INTERVAL_MS};

const HOST_RELAY_ALLOWED: StopPolicy = StopPolicy {
    allow_host_relay_only: true,
};

fn supervisor() -> (Arc<Supervisor>, Arc<FakeClock>) {
    let clock = Arc::new(FakeClock::new(1_000));
    (Arc::new(Supervisor::new(clock.clone())), clock)
}

#[test]
fn chord_parsing_normalizes_key_names() {
    let chord = Chord::parse(" Ctrl+ALT + shift+Escape").unwrap();
    assert_eq!(chord.keys(), ["ctrl", "alt", "shift", "escape"]);
    assert_eq!(chord.to_string(), "ctrl+alt+shift+escape");
}

#[test]
fn a_chord_with_an_empty_key_is_rejected() {
    for chord in ["", "ctrl++escape", "ctrl+"] {
        assert_eq!(
            Chord::parse(chord),
            Err(StopPathError::InvalidChord(chord.to_owned()))
        );
    }
}

#[test]
fn a_heartbeat_before_start_does_not_make_the_relay_live() {
    // Given: an unarmed relay
    let (supervisor, _clock) = supervisor();
    let relay = HostRelay::new();
    // When
    relay.heartbeat();
    // Then
    assert!(!relay.is_live());
    assert_eq!(supervisor.status().stop_path, ActiveStopPath::None);
}

#[test]
fn start_marks_the_relay_live_for_any_chord() {
    // Given
    let (supervisor, _clock) = supervisor();
    let mut relay = HostRelay::new();
    // When
    let started = relay.start(
        &Chord::parse("ctrl+alt+shift+escape").unwrap(),
        supervisor.clone(),
    );
    // Then
    assert_eq!(started, Ok(()));
    assert!(relay.is_live());
    assert_eq!(supervisor.status().stop_path, ActiveStopPath::HostRelay);
    assert!(supervisor.input_allowed(&HOST_RELAY_ALLOWED));
}

#[test]
fn host_heartbeats_keep_the_relay_fresh_past_the_freshness_window() {
    // Given: an armed relay
    let (supervisor, clock) = supervisor();
    let mut relay = HostRelay::new();
    relay.arm(supervisor.clone());
    // When: the host beats on schedule for longer than the window
    for _ in 0..=(HEARTBEAT_FRESH_MS / HEARTBEAT_INTERVAL_MS) {
        clock.advance(HEARTBEAT_INTERVAL_MS);
        relay.heartbeat();
    }
    // Then
    assert!(supervisor.status().heartbeat_fresh);
}

#[test]
fn a_silent_host_goes_stale_but_stays_live() {
    // Given: an armed relay
    let (supervisor, clock) = supervisor();
    let mut relay = HostRelay::new();
    relay.arm(supervisor.clone());
    // When: the host stops beating past the window
    clock.advance(HEARTBEAT_FRESH_MS + 100);
    // Then: input is refused, but no stop was latched
    let status = supervisor.status();
    assert!(relay.is_live());
    assert!(!status.heartbeat_fresh);
    assert!(!status.suspended);
    assert!(!supervisor.input_allowed(&HOST_RELAY_ALLOWED));
}
