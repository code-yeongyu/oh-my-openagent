//! Row 50's review fixes at 77a028eea1 (M2, L2, L3, L6, L7), the configured stop chord of
//! A-IS-62 and the platform constant of A-IS-64, on the in-memory servers.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use omo_computer_core::backend::{Backend, BackendResult, EpochChange, EpochSource, Refusal};
use omo_computer_core::capabilities::DeafReason;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::report::Platform;
use omo_computer_core::results::ProbeState;
use omo_computer_safety::timing::RE_ARM_LADDER_MS;
use omo_computer_safety::{MemoryMarker, NoHolds, StopPathFailure, StopPolicy, Supervisor};

use super::fake::{FakeKeys, KEY_A, KEY_ALT_L, KEY_CONTROL_L, KEY_ESCAPE, KEY_SHIFT_L, PHYSICAL};
use super::server::DeviceFacts;
use super::source::{classify, xtest_property, AtomRead};
use super::{arm, Armed, LeaseEndSignal, Live, DEFAULT_STOP_CHORD};
use crate::capture::fake::FakeX;
use crate::diagnose::{probes, BusReach, CompositorRead, HostReads, Uinput};
use crate::X11Backend;

fn deaf() -> Refusal {
    Refusal::new(EngineCode::StopPathUnavailable, Reason::Deaf.wire())
}

fn backend(keys: &FakeKeys) -> X11Backend<FakeX> {
    X11Backend::with_live(None, Live::for_display(None).with_keys(keys.clone()))
}

#[test]
fn with_no_configured_chord_the_listener_reads_deaf_chord_unarmable() {
    let keys = FakeKeys::new((2, 2));
    let mut backend = backend(&keys);
    assert_eq!(backend.stop_listener().err(), Some(deaf()), "no default-chord fallback");
    assert_eq!(
        backend.capabilities().stop_path.deaf_reason,
        Some(DeafReason::ChordUnarmable)
    );
}

#[test]
fn the_configured_chord_is_the_one_the_listener_arms() {
    let keys = FakeKeys::new((2, 2));
    let mut backend = backend(&keys);
    assert_eq!(backend.set_stop_chord(Some("ctrl+alt+a")), Ok(()));
    let Ok(mut listener) = backend.stop_listener() else {
        panic!("the configured chord arms a live listener");
    };
    keys.chord(PHYSICAL, &[KEY_CONTROL_L, KEY_ALT_L, KEY_SHIFT_L, KEY_ESCAPE]);
    assert_eq!(listener.poll_stop(), Ok(false), "the default chord is not listened for");
    keys.chord(PHYSICAL, &[KEY_CONTROL_L, KEY_ALT_L, KEY_A]);
    assert_eq!(listener.poll_stop(), Ok(true));
}

#[test]
fn an_unparseable_chord_is_refused_deaf_and_nothing_is_armed() {
    let keys = FakeKeys::new((2, 2));
    let mut backend = backend(&keys);
    assert_eq!(backend.set_stop_chord(Some("ctrl+alt+nonsense")), Err(deaf()));
    assert_eq!(backend.stop_listener().err(), Some(deaf()));
    assert_eq!(
        backend.capabilities().stop_path.deaf_reason,
        Some(DeafReason::ChordUnarmable)
    );
}

#[test]
fn a_chord_the_keymap_cannot_type_reads_deaf_chord_unarmable() {
    let keys = FakeKeys::new((2, 2));
    let armed = arm(keys.boxed(), "ctrl+alt+b", LeaseEndSignal::default());
    assert!(matches!(armed, Ok(Armed::Deaf(DeafReason::ChordUnarmable))));
}

#[test]
fn a_server_that_cannot_hear_refuses_the_arm_as_deaf_with_its_reason() {
    let keys = FakeKeys::new((2, 0));
    let mut backend = backend(&keys);
    assert_eq!(backend.set_stop_chord(Some(DEFAULT_STOP_CHORD)), Ok(()));
    assert_eq!(backend.stop_listener().err(), Some(deaf()));
    assert_eq!(
        backend.capabilities().stop_path.deaf_reason,
        Some(DeafReason::Xi2RawUnavailable)
    );
}

#[test]
fn a_re_arm_onto_a_deaf_server_is_refused_on_the_same_call() {
    let keys = FakeKeys::new((2, 2));
    let mut backend = backend(&keys);
    assert_eq!(backend.set_stop_chord(Some(DEFAULT_STOP_CHORD)), Ok(()));
    let mut supervisor = Supervisor::new(
        Box::new(MemoryMarker::default()),
        StopPolicy {
            allow_host_relay_only: true,
        },
    );
    supervisor.arm(backend.stop_listener(), None, 0);
    keys.lock().alive = false;
    supervisor.observe(0, &mut || backend.stop_listener(), &mut NoHolds);
    {
        let mut state = keys.lock();
        state.alive = true;
        state.version = (2, 0);
    }
    let now = RE_ARM_LADDER_MS[0];
    supervisor.observe(now, &mut || backend.stop_listener(), &mut NoHolds);
    supervisor.heartbeat(now);
    assert_eq!(
        supervisor.view(now).admit(),
        Err(StopPathFailure::Deaf),
        "the re-armed deaf listener refuses at once, live relay or not"
    );
}

/// A source that reports a flip on its own second read: a fresh source per poll never does.
#[derive(Default)]
struct FlipsOnSecondRead {
    reads: u32,
}

impl EpochSource for FlipsOnSecondRead {
    fn next_change(&mut self) -> BackendResult<Option<EpochChange>> {
        self.reads += 1;
        Ok((self.reads == 2).then(|| EpochChange {
            reason: "display".to_owned(),
        }))
    }
}

#[test]
fn the_epoch_source_keeps_its_layout_across_the_sessions_polls() {
    let opened = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&opened);
    let mut live = Live::for_display(None).with_epochs(Box::new(move || {
        counter.fetch_add(1, Ordering::SeqCst);
        Some(Box::new(FlipsOnSecondRead::default()) as Box<dyn EpochSource + Send>)
    }));
    assert_eq!(live.epoch_source().next_change(), Ok(None), "nothing changed yet");
    assert_eq!(
        live.epoch_source().next_change().map(|c| c.map(|c| c.reason)),
        Ok(Some("display".to_owned())),
        "the next poll compares with the layout the first one saw"
    );
    assert_eq!(opened.load(Ordering::SeqCst), 1, "one connection, not one per poll");
}

#[test]
fn an_xtest_atom_that_cannot_be_interned_fails_closed() {
    assert_eq!(xtest_property(AtomRead::Failed, |_| Some(false)), None);
    assert_eq!(xtest_property(AtomRead::Absent, |_| Some(true)), Some(false));
    assert_eq!(xtest_property(AtomRead::Interned(7), |atom| Some(atom == 7)), Some(true));
    let unread = DeviceFacts {
        slave_keyboard: true,
        name: b"AT Translated Set 2 keyboard".to_vec(),
        xtest_property: xtest_property(AtomRead::Failed, |_| Some(false)),
    };
    assert_eq!(classify(Some(&unread)), (false, false), "not physical, not cached");
}

#[test]
fn a_compositor_read_that_failed_is_unknown() {
    let reads = HostReads {
        display: true,
        bus: BusReach::Unreachable,
        uinput: Uinput::Absent,
        compositor: CompositorRead::Failed,
    };
    let check = probes(reads)
        .checks
        .into_iter()
        .find(|check| check.name == "compositor");
    assert_eq!(
        check.map(|check| (check.state, check.reason)),
        Some((ProbeState::Unknown, Some("read_failed".to_owned())))
    );
}

#[test]
fn the_x11_backend_declares_the_x11_platform() {
    assert_eq!(X11Backend::from_env(None, None).platform(), Some(Platform::X11));
}
