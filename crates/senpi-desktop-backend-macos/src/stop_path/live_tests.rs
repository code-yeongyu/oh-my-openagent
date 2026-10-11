//! Live checks of the kill-switch tap on a logged-in macOS session.
//! `#[ignore]`d: all but the denial check need an Accessibility grant for the
//! launching process. Run with `--ignored --nocapture`; each prints
//! machine-read `key=value` facts for the QA evidence.

use std::sync::Arc;
use std::time::{Duration, Instant};

use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use senpi_desktop_safety::{Chord, MonotonicClock, StopPathError, StopPathListener, Supervisor};

use super::tap::Simulate;
use super::{CgEventTapListener, Control, Shared, DEFAULT_STOP_CHORD};

/// Hang guard only; the latency bound is asserted separately.
const HANG_GUARD: Duration = Duration::from_secs(30);
/// The plan's bound between the synthetic post and the latched stop.
const STOP_LATENCY: Duration = Duration::from_millis(200);
const ESCAPE: u16 = 53;
const F19: u16 = 80;

fn supervisor() -> Arc<Supervisor> {
    Arc::new(Supervisor::new(Arc::new(MonotonicClock::new())))
}

fn started(supervisor: &Arc<Supervisor>) -> CgEventTapListener {
    assert!(
        crate::ax::is_trusted(),
        "precondition: the launcher needs Accessibility"
    );
    let mut listener = CgEventTapListener::new();
    listener
        .start(&Chord::parse(DEFAULT_STOP_CHORD).unwrap(), Arc::clone(supervisor))
        .unwrap();
    listener
}

fn shared(listener: &CgEventTapListener) -> &Shared {
    listener.shared.as_deref().unwrap()
}

/// Blocks until `ready` holds, bounded by the hang guard.
fn wait_for(shared: &Shared, mut ready: impl FnMut(&Control) -> bool) {
    let mut control = shared.control.lock();
    let waited = shared
        .changed
        .wait_while_for(&mut control, |control| !ready(control), HANG_GUARD);
    assert!(!waited.timed_out(), "hang guard expired");
}

/// The default chord (Escape with Control+Option+Command) as HID key-down
/// and key-up events. A stray F19 key-up is posted first: the first post of
/// a process connects to the window server and takes ~1 s, which the timed
/// post must not include.
fn default_chord_events() -> [CGEvent; 2] {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
    post(&[CGEvent::new_keyboard_event(source.clone(), F19, false).unwrap()]);
    let flags = CGEventFlags::CGEventFlagControl
        | CGEventFlags::CGEventFlagAlternate
        | CGEventFlags::CGEventFlagCommand;
    [true, false].map(|down| {
        let event = CGEvent::new_keyboard_event(source.clone(), ESCAPE, down).unwrap();
        event.set_flags(flags);
        event
    })
}

fn post(events: &[CGEvent]) {
    for event in events {
        event.post(CGEventTapLocation::HID);
    }
}

#[test]
#[ignore = "live: posts the kill-switch chord; needs Accessibility for the launcher"]
fn synthetic_hotkey_latches_supervisor() {
    // Given: a live tap
    let supervisor = supervisor();
    let listener = started(&supervisor);
    let before = supervisor.status();
    println!(
        "stopPathStatus.globalLive={} stopPath={} suspended={}",
        before.global_live,
        before.stop_path.as_str(),
        before.suspended
    );
    assert!(before.global_live && !before.suspended);
    let chord = default_chord_events();
    // When
    let posted = Instant::now();
    post(&chord);
    wait_for(shared(&listener), |control| control.stops > 0);
    let elapsed = posted.elapsed();
    // Then
    let after = supervisor.status();
    println!(
        "suspended={} stopped_by={:?} elapsed_ms={}",
        after.suspended,
        after.stopped_by,
        elapsed.as_millis()
    );
    assert!(after.suspended);
    assert!(elapsed <= STOP_LATENCY);
}

#[test]
#[ignore = "live: disables the kill-switch tap; needs Accessibility for the launcher"]
fn tap_disabled_by_timeout_re_arms() {
    // Given: a live tap
    let supervisor = supervisor();
    let listener = started(&supervisor);
    let shared = shared(&listener);
    // When: the OS disables the tap and reports the timeout to the callback
    shared.update(|control| control.hooks.simulate = Some(Simulate::DisabledByTimeout));
    wait_for(shared, |control| control.hooks.simulated_step_live.is_some());
    // Then: the callback re-enabled it before the path could drop
    let timeout_step = shared.control.lock().hooks.simulated_step_live;
    println!("timeout_step_live={timeout_step:?}");
    assert_eq!(timeout_step, Some(true));

    // When: the tap is disabled and stays so
    let taps = shared.control.lock().hooks.went_live;
    shared.update(|control| {
        control.hooks.simulated_step_live = None;
        control.hooks.simulate = Some(Simulate::Disabled);
    });
    wait_for(shared, |control| control.hooks.simulated_step_live.is_some());
    let disabled = Instant::now();
    let disabled_step = shared.control.lock().hooks.simulated_step_live;
    // Then: the path dropped, a new tap came up on the ladder, and it stops
    wait_for(shared, |control| control.hooks.went_live > taps);
    println!(
        "disabled_step_live={disabled_step:?} re_armed_after_ms={}",
        disabled.elapsed().as_millis()
    );
    assert_eq!(disabled_step, Some(false));
    post(&default_chord_events());
    wait_for(shared, |control| control.stops > 0);
    println!("re_armed_tap_suspended={}", supervisor.is_suspended());
    assert!(supervisor.is_suspended());
}

#[test]
#[ignore = "live: run from a launcher WITHOUT an Accessibility grant"]
fn start_without_accessibility_is_permission_denied() {
    assert!(
        !crate::ax::is_trusted(),
        "precondition: this launcher must lack Accessibility"
    );
    let supervisor = supervisor();
    let mut listener = CgEventTapListener::new();
    let started = listener.start(
        &Chord::parse(DEFAULT_STOP_CHORD).unwrap(),
        Arc::clone(&supervisor),
    );
    let global_live = supervisor.status().global_live;
    println!("start={started:?} stopPathStatus.globalLive={global_live}");
    assert!(matches!(started, Err(StopPathError::PermissionDenied(_))));
    assert!(!global_live && !listener.is_live());
}
