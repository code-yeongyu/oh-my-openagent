//! Live checks of the XI2 kill switch. `#[ignore]`d: they need an X server
//! on `DISPLAY` (xvfb-run) and `xdotool` on `PATH` to post the chord from a
//! separate process. Run with `--ignored --nocapture`; each prints
//! machine-read `key=value` facts for the QA evidence.

use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

use senpi_desktop_safety::{Chord, MonotonicClock, StopPathError, StopPathListener, StopSource, Supervisor};

use super::xi2::CONNECTION_FAILED;
use super::{Xi2Listener, DEFAULT_STOP_CHORD};

/// Hang guard only; the latency is printed for the evidence, not asserted.
const HANG_GUARD: Duration = Duration::from_secs(30);

fn supervisor() -> Arc<Supervisor> {
    Arc::new(Supervisor::new(Arc::new(MonotonicClock::new())))
}

#[test]
#[ignore = "live: needs an X server on DISPLAY and xdotool"]
fn raw_key_chord_latches_supervisor() {
    // Given: a live listener and an unsuspended supervisor
    let supervisor = supervisor();
    let mut listener = Xi2Listener::new();
    listener
        .start(
            &Chord::parse(DEFAULT_STOP_CHORD).unwrap(),
            Arc::clone(&supervisor),
        )
        .unwrap();
    let shared = Arc::clone(listener.shared.as_ref().unwrap());
    let before = supervisor.status();
    assert!(listener.is_live() && before.global_live && !before.suspended);

    // When: another process posts the chord through XTEST
    let posted = Instant::now();
    let xdotool = Command::new("xdotool")
        .args(["key", "ctrl+alt+shift+Escape"])
        .status()
        .unwrap();
    let xdotool_exited = Instant::now();

    // Then: the listener latches the supervisor
    let mut control = shared.control.lock();
    let waited = shared
        .changed
        .wait_while_for(&mut control, |control| control.stops == 0, HANG_GUARD);
    let latched = Instant::now();
    drop(control);
    let status = supervisor.status();
    println!(
        "xdotool_status={xdotool} suspended_before={} suspended={} stopped_by={:?} global_live={} \
         latch_ms_from_post={} latch_ms_after_xdotool_exit={}",
        before.suspended,
        status.suspended,
        status.stopped_by,
        status.global_live,
        latched.duration_since(posted).as_millis(),
        latched.saturating_duration_since(xdotool_exited).as_millis(),
    );
    assert!(xdotool.success());
    assert!(!waited.timed_out(), "hang guard expired");
    assert!(status.suspended);
    assert_eq!(status.stopped_by, Some(StopSource::Hotkey));
}

#[test]
#[ignore = "live: run with DISPLAY unset"]
fn start_without_a_display_is_unavailable_and_not_live() {
    assert!(
        std::env::var_os("DISPLAY").is_none(),
        "precondition: DISPLAY unset"
    );
    let supervisor = supervisor();
    let mut listener = Xi2Listener::new();

    let started = listener.start(
        &Chord::parse(DEFAULT_STOP_CHORD).unwrap(),
        Arc::clone(&supervisor),
    );

    println!(
        "started={started:?} is_live={} global_live={}",
        listener.is_live(),
        supervisor.status().global_live
    );
    assert_eq!(
        started,
        Err(StopPathError::Unavailable {
            reason: CONNECTION_FAILED.to_owned()
        })
    );
    assert!(!listener.is_live() && !supervisor.status().global_live);
}
