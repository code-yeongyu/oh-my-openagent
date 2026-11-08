//! Live checks of the keyboard-hook kill switch. `#[ignore]`d: they need
//! an interactive window station (the `windows-latest` runner has one). Run
//! with `--ignored --nocapture`; each prints machine-read `key=value` facts
//! for the QA evidence.

use std::sync::Arc;
use std::time::{Duration, Instant};

use senpi_desktop_core::backend::{Backend, DeliveryMode};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{DisplaySelector, Target};
use senpi_desktop_safety::{Chord, MonotonicClock, StopPathListener, Supervisor};

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
fn an_injected_chord_never_latches() {
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

    // Then: the hook saw the injected trigger (so the check is not vacuous)
    // and ignored it; the RegisterHotKey backstop deferred to the hook.
    let mut control = shared.control.lock();
    let waited = shared.changed.wait_while_for(
        &mut control,
        |control| control.injected_ignored == 0 && control.stops == 0,
        HANG_GUARD,
    );
    let seen = posted.elapsed();
    let (ignored, stops) = (control.injected_ignored, control.stops);
    drop(control);
    let status = supervisor.status();
    println!(
        "sent={sent:?} injected_ignored={ignored} stops={stops} suspended={} global_live={} seen_ms_from_post={}",
        status.suspended,
        status.global_live,
        seen.as_millis(),
    );
    assert_eq!(sent, Ok(()));
    assert!(!waited.timed_out(), "hang guard expired");
    assert!(ignored > 0, "the hook never saw the injected trigger");
    assert!(!status.suspended, "an injected chord stopped input");
    assert_eq!(stops, 0);
    assert!(status.global_live, "the listener must stay armed");
}

#[test]
#[ignore = "live: needs an interactive Windows desktop"]
fn a_second_listener_is_live_while_the_first_holds_the_hotkey() {
    // Given: one listener holds the RegisterHotKey backstop for the chord
    let chord = Chord::parse("ctrl+alt+shift+f11").unwrap();
    let mut holder = HotkeyListener::new();
    holder.start(&chord, supervisor()).unwrap();
    let supervisor = supervisor();
    let mut second = HotkeyListener::new();

    // When: a second session's engine arms the same chord
    let started = second.start(&chord, Arc::clone(&supervisor));

    // Then: its hook makes it live; only the backstop is shared
    println!(
        "holder_live={} started={started:?} second_live={} global_live={}",
        holder.is_live(),
        second.is_live(),
        supervisor.status().global_live
    );
    assert_eq!(started, Ok(()));
    assert!(holder.is_live() && second.is_live() && supervisor.status().global_live);
}

#[test]
#[ignore = "live: needs an interactive Windows desktop"]
fn dropping_the_listener_removes_its_hook_and_ends_both_threads() {
    use std::sync::atomic::Ordering;

    use super::hook::INSTALLED;

    // Given: a live listener (its hook is installed)
    let before = INSTALLED.load(Ordering::SeqCst);
    let supervisor = supervisor();
    let mut listener = HotkeyListener::new();
    listener
        .start(&Chord::parse(DEFAULT_STOP_CHORD).unwrap(), Arc::clone(&supervisor))
        .unwrap();
    let shared = Arc::clone(listener.shared.as_ref().unwrap());
    let while_live = INSTALLED.load(Ordering::SeqCst);

    // When: the session disposes of it
    drop(listener);

    // Then: both threads exit, the path is down, and the hook is gone
    let mut control = shared.control.lock();
    let waited = shared.changed.wait_while_for(
        &mut control,
        |control| !(control.listener_exited && control.worker_exited),
        HANG_GUARD,
    );
    let (shutdown, live) = (control.shutdown, control.live);
    drop(control);
    let after = INSTALLED.load(Ordering::SeqCst);
    println!("hooks_before={before} hooks_live={while_live} hooks_after={after} shutdown={shutdown} live={live}");
    assert!(!waited.timed_out(), "a listener thread outlived the drop");
    assert!(shutdown && !live);
    assert_eq!(while_live, before + 1);
    assert_eq!(after, before);
    assert!(!supervisor.status().global_live);
}
