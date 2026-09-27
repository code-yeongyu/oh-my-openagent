//! Live checks of the `RegisterHotKey` kill switch. `#[ignore]`d: they need
//! an interactive window station (the `windows-latest` runner has one). Run
//! with `--ignored --nocapture`; each prints machine-read `key=value` facts
//! for the QA evidence.

use std::sync::Arc;
use std::time::{Duration, Instant};

use senpi_desktop_core::backend::{Backend, DeliveryMode};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{DisplaySelector, Target};
use senpi_desktop_safety::{Chord, MonotonicClock, StopPathError, StopPathListener, StopSource, Supervisor};

use super::hotkey::CHORD_TAKEN;
use super::{HotkeyListener, DEFAULT_STOP_CHORD};
use crate::input::live_tests::LIVE_INPUT;
use crate::Win32Backend;

/// Hang guard only; the latency is printed for the evidence, not asserted.
const HANG_GUARD: Duration = Duration::from_secs(30);

fn supervisor() -> Arc<Supervisor> {
    Arc::new(Supervisor::new(Arc::new(MonotonicClock::new())))
}

#[test]
#[ignore = "live: needs an interactive Windows desktop"]
fn registered_hotkey_latches() {
    let _input = LIVE_INPUT.lock();
    // Given: a live listener and an unsuspended supervisor
    let supervisor = supervisor();
    let mut listener = HotkeyListener::new();
    listener
        .start(
            &Chord::parse(DEFAULT_STOP_CHORD).unwrap(),
            Arc::clone(&supervisor),
        )
        .unwrap();
    let shared = Arc::clone(listener.shared.as_ref().unwrap());
    let before = supervisor.status();
    assert!(listener.is_live() && before.global_live && !before.suspended);

    // When: the test posts the chord through SendInput (enigo, desktop target)
    let mut backend = Win32Backend::new(DisplaySelector::All).unwrap();
    let posted = Instant::now();
    let sent = Backend::key_chord(
        &mut backend,
        &Target::Desktop,
        &[KeyName::Ctrl, KeyName::Alt, KeyName::Shift, KeyName::Escape],
        DeliveryMode::Background,
    );

    // Then: the listener latches the supervisor
    let mut control = shared.control.lock();
    let waited = shared
        .changed
        .wait_while_for(&mut control, |control| control.stops == 0, HANG_GUARD);
    let latched = posted.elapsed();
    drop(control);
    let status = supervisor.status();
    println!(
        "sent={sent:?} suspended_before={} suspended={} stopped_by={:?} global_live={} latch_ms_from_post={}",
        before.suspended,
        status.suspended,
        status.stopped_by,
        status.global_live,
        latched.as_millis(),
    );
    assert_eq!(sent, Ok(()));
    assert!(!waited.timed_out(), "hang guard expired");
    assert!(status.suspended);
    assert_eq!(status.stopped_by, Some(StopSource::Hotkey));
}

#[test]
#[ignore = "live: needs an interactive Windows desktop"]
fn a_chord_registered_elsewhere_is_not_live_with_chord_taken() {
    // Given: the chord is already registered by another listener
    let chord = Chord::parse("ctrl+alt+shift+f11").unwrap();
    let mut holder = HotkeyListener::new();
    holder.start(&chord, supervisor()).unwrap();
    let supervisor = supervisor();
    let mut second = HotkeyListener::new();

    // When
    let started = second.start(&chord, Arc::clone(&supervisor));

    // Then
    println!(
        "holder_live={} started={started:?} second_live={} global_live={}",
        holder.is_live(),
        second.is_live(),
        supervisor.status().global_live
    );
    assert_eq!(
        started,
        Err(StopPathError::Unavailable {
            reason: CHORD_TAKEN.to_owned()
        })
    );
    assert!(!second.is_live() && !supervisor.status().global_live);
}
