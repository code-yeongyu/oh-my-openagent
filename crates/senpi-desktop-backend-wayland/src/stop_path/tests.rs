//! The GlobalShortcuts listener against the fake portal: binding, the
//! `Activated` latch, refusal and absence, and a closed session.

use std::sync::Arc;

use senpi_desktop_safety::{Chord, FakeClock, StopPathError, StopPathListener, Supervisor};

use super::global_shortcuts::Control;
use super::{GlobalShortcutsListener, STOP_SHORTCUT_ID, UNAVAILABLE};
use crate::test_support::fake_eis::EisConfig;
use crate::test_support::fake_portal::{fake_bus, FakeBus, Mode, Reply, Shot};
use crate::test_support::{env_lock, HANG_GUARD};

const CHORD: &str = "ctrl+alt+shift+escape";

fn portal(global_shortcuts: Reply) -> &'static FakeBus {
    fake_bus(Mode {
        remote_desktop: Reply::Absent,
        global_shortcuts,
        screenshot: Shot::Absent,
        eis: EisConfig { keymap: "", group: 0 },
    })
}

fn supervisor() -> Arc<Supervisor> {
    Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))))
}

fn start(listener: &mut GlobalShortcutsListener, supervisor: &Arc<Supervisor>) -> Result<(), StopPathError> {
    listener.start(&Chord::parse(CHORD).expect("chord"), Arc::clone(supervisor))
}

/// Blocks until `ready` holds for the listener's state, bounded by the hang guard.
fn wait_for(listener: &GlobalShortcutsListener, ready: impl Fn(&Control) -> bool) {
    let shared = listener.shared().expect("a started listener");
    let mut control = shared.control.lock();
    let waited = shared
        .changed
        .wait_while_for(&mut control, |control| !ready(control), HANG_GUARD);
    assert!(!waited.timed_out(), "hang guard expired: {:?}", *control);
}

#[test]
fn start_binds_the_stop_chord_as_the_preferred_trigger() {
    let _env = env_lock();
    let bus = portal(Reply::Grant);
    let supervisor = supervisor();
    let mut listener = GlobalShortcutsListener::new();

    let started = start(&mut listener, &supervisor);

    assert_eq!(started, Ok(()));
    assert!(listener.is_live() && supervisor.status().global_live);
    assert_eq!(
        bus.state.recorded().bound,
        [(
            STOP_SHORTCUT_ID.to_owned(),
            Some("CTRL+ALT+SHIFT+Escape".to_owned())
        )]
    );
}

#[test]
fn start_from_inside_a_multi_thread_runtime_binds_without_panicking() {
    // Given: the engine answers stopPath.start on a tokio worker thread.
    let _env = env_lock();
    portal(Reply::Grant);
    let supervisor = supervisor();
    let engine = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .build()
        .expect("engine runtime");
    // When
    let (started, live) = engine.block_on(async {
        tokio::spawn(async move {
            let mut listener = GlobalShortcutsListener::new();
            let started = start(&mut listener, &supervisor);
            (started, listener.is_live())
        })
        .await
        .expect("the start task must not panic")
    });
    // Then
    assert_eq!((started, live), (Ok(()), true));
}

#[test]
fn only_the_stop_shortcut_activation_latches_the_supervisor() {
    // Given: a bound listener
    let _env = env_lock();
    let bus = portal(Reply::Grant);
    let supervisor = supervisor();
    let mut listener = GlobalShortcutsListener::new();
    assert_eq!(start(&mut listener, &supervisor), Ok(()));

    // When: another shortcut fires, then the stop shortcut
    bus.activate("someone-elses-shortcut");
    wait_for(&listener, |control| control.seen >= 1);
    let after_foreign = supervisor.is_suspended();
    bus.activate(STOP_SHORTCUT_ID);
    wait_for(&listener, |control| control.seen >= 2);

    // Then: only the stop shortcut latched
    assert!(!after_foreign, "a foreign shortcut must not stop input");
    assert!(supervisor.is_suspended());
}

#[test]
fn a_denied_binding_leaves_the_global_path_down_with_the_portal_reason() {
    let _env = env_lock();
    portal(Reply::Deny);
    let supervisor = supervisor();
    let mut listener = GlobalShortcutsListener::new();

    let started = start(&mut listener, &supervisor);

    let reason = started.as_ref().map_err(StopPathError::reason).err();
    assert_eq!(reason, Some(UNAVAILABLE));
    assert_eq!(UNAVAILABLE, "portal-global-shortcuts-unavailable");
    assert!(!listener.is_live() && !supervisor.status().global_live);
}

#[test]
fn a_missing_portal_leaves_the_global_path_down_with_the_portal_reason() {
    let _env = env_lock();
    portal(Reply::Absent);
    let supervisor = supervisor();
    let mut listener = GlobalShortcutsListener::new();

    let started = start(&mut listener, &supervisor);

    assert_eq!(
        started.as_ref().map_err(StopPathError::reason).err(),
        Some(UNAVAILABLE)
    );
    assert!(!supervisor.status().global_live);
}

#[test]
fn a_session_the_portal_closes_takes_the_global_path_down() {
    let _env = env_lock();
    let bus = portal(Reply::Grant);
    let supervisor = supervisor();
    let mut listener = GlobalShortcutsListener::new();
    assert_eq!(start(&mut listener, &supervisor), Ok(()));

    bus.close_shortcuts_session();
    wait_for(&listener, |control| !control.live);

    assert!(!listener.is_live() && !supervisor.status().global_live);
}

#[test]
fn an_invalid_chord_is_refused_before_touching_the_portal() {
    let supervisor = supervisor();
    let mut listener = GlobalShortcutsListener::new();

    let started = listener.start(&Chord::parse("ctrl+alt").expect("chord"), supervisor);

    assert_eq!(started, Err(StopPathError::InvalidChord("ctrl+alt".to_owned())));
}
