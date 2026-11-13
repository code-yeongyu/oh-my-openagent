//! The X11 stop path on the in-memory raw-key server: XTEST never stops, a server whose raw
//! events a grab could swallow reads deaf, Escape ends the lease, and a dead connection parks
//! after the bounded re-arm ladder.

use omo_computer_core::backend::{BackendResult, StopListener};
use omo_computer_core::capabilities::DeafReason;
use omo_computer_safety::stop_path::GlobalListener;
use omo_computer_safety::timing::RE_ARM_LADDER_MS;
use omo_computer_safety::{MemoryMarker, NoHolds, StopPathFailure, StopPolicy, Supervisor};

use super::fake::{
    FakeKeys, KEY_A, KEY_ALT_L, KEY_CONTROL_L, KEY_ESCAPE, KEY_SHIFT_L, PHYSICAL, XTEST,
};
use super::{arm, Armed, LeaseEndSignal, X11StopListener, DEFAULT_STOP_CHORD};

const CHORD: [u8; 4] = [KEY_CONTROL_L, KEY_ALT_L, KEY_SHIFT_L, KEY_ESCAPE];

fn live(keys: &FakeKeys, lease_end: LeaseEndSignal) -> X11StopListener {
    match arm(keys.boxed(), DEFAULT_STOP_CHORD, lease_end) {
        Ok(Armed::Live(listener)) => listener,
        Ok(Armed::Deaf(reason)) => panic!("armed deaf: {reason:?}"),
        Err(_) => panic!("connection lost while arming"),
    }
}

fn boxed(listener: X11StopListener) -> BackendResult<Box<dyn StopListener>> {
    Ok(Box::new(listener))
}

#[test]
fn xtest_chord_never_latches_the_stop() {
    let keys = FakeKeys::new((2, 2));
    let mut listener = live(&keys, LeaseEndSignal::default());

    keys.chord(XTEST, &CHORD);
    assert_eq!(
        listener.poll_stop(),
        Ok(false),
        "an XTEST chord never stops"
    );
    assert_eq!(listener.xtest_ignored(), 4);

    keys.chord(PHYSICAL, &CHORD);
    assert_eq!(
        listener.poll_stop(),
        Ok(true),
        "the same chord from a keyboard stops"
    );
}

#[test]
fn an_xtest_modifier_never_completes_a_physical_chord() {
    let keys = FakeKeys::new((2, 2));
    let mut listener = live(&keys, LeaseEndSignal::default());
    {
        let mut state = keys.lock();
        for code in [KEY_CONTROL_L, KEY_ALT_L, KEY_SHIFT_L] {
            state.queue.push_back(super::RawKey::Press {
                device: XTEST,
                code,
            });
        }
        state.queue.push_back(super::RawKey::Press {
            device: PHYSICAL,
            code: KEY_ESCAPE,
        });
    }
    assert_eq!(listener.poll_stop(), Ok(false));
}

#[test]
fn an_undescribed_device_fails_closed() {
    let keys = FakeKeys::new((2, 2));
    let mut listener = live(&keys, LeaseEndSignal::default());
    keys.chord(77, &CHORD);
    assert_eq!(listener.poll_stop(), Ok(false));
}

#[test]
fn xi2_below_2_1_is_stop_path_unavailable() {
    for version in [(2, 0), (1, 5), (0, 0)] {
        let keys = FakeKeys::new(version);
        let armed = arm(keys.boxed(), DEFAULT_STOP_CHORD, LeaseEndSignal::default());
        assert!(
            matches!(armed, Ok(Armed::Deaf(DeafReason::Xi2RawUnavailable))),
            "XI {version:?} must read deaf"
        );
    }
    let mut supervisor = Supervisor::new(
        Box::new(MemoryMarker::default()),
        StopPolicy {
            allow_host_relay_only: true,
        },
    );
    supervisor.arm(
        Ok(Box::new(super::DeafListener)),
        Some(DeafReason::Xi2RawUnavailable),
        0,
    );
    supervisor.observe(0, &mut || Ok(Box::new(super::DeafListener)), &mut NoHolds);
    supervisor.heartbeat(0);
    assert_eq!(
        supervisor.view(0).admit(),
        Err(StopPathFailure::Deaf),
        "a deaf listener refuses even with a live relay"
    );
}

#[test]
fn a_refused_raw_selection_reads_deaf() {
    let keys = FakeKeys::new((2, 2));
    keys.lock().select_refused = true;
    let armed = arm(keys.boxed(), DEFAULT_STOP_CHORD, LeaseEndSignal::default());
    assert!(matches!(
        armed,
        Ok(Armed::Deaf(DeafReason::Xi2RawUnavailable))
    ));
}

#[test]
fn a_bare_physical_escape_ends_the_lease_and_a_chord_does_not() {
    let keys = FakeKeys::new((2, 2));
    let lease_end = LeaseEndSignal::default();
    let mut listener = live(&keys, lease_end.clone());

    keys.chord(XTEST, &[KEY_ESCAPE]);
    assert_eq!(listener.poll_stop(), Ok(false));
    assert!(!lease_end.take(), "an injected Escape never ends the lease");

    keys.chord(PHYSICAL, &[KEY_A, KEY_ESCAPE]);
    assert_eq!(listener.poll_stop(), Ok(false));
    assert!(
        !lease_end.take(),
        "Escape with another key held is not a bare Escape"
    );

    keys.chord(PHYSICAL, &[KEY_ESCAPE]);
    assert_eq!(listener.poll_stop(), Ok(false));
    assert!(lease_end.take());
    assert!(!lease_end.take(), "taken once");
}

#[test]
fn x11_stop_listener_parks_after_the_bounded_restart_budget() {
    let keys = FakeKeys::new((2, 2));
    let mut supervisor = Supervisor::new(
        Box::new(MemoryMarker::default()),
        StopPolicy {
            allow_host_relay_only: false,
        },
    );
    supervisor.arm(boxed(live(&keys, LeaseEndSignal::default())), None, 0);
    assert_eq!(supervisor.view(0).global, GlobalListener::Fresh);

    keys.lock().alive = false;
    let attempts = std::cell::Cell::new(0_usize);
    let mut rearm = || {
        attempts.set(attempts.get() + 1);
        match arm(keys.boxed(), DEFAULT_STOP_CHORD, LeaseEndSignal::default()) {
            Ok(Armed::Live(listener)) => boxed(listener),
            _ => Err(omo_computer_core::backend::Refusal::bare(
                omo_computer_core::error::EngineCode::StopPathUnavailable,
            )),
        }
    };
    supervisor.observe(0, &mut rearm, &mut NoHolds);
    assert!(
        matches!(supervisor.view(0).global, GlobalListener::Stale { .. }),
        "a dead connection is stale, not yet deaf"
    );

    let mut now = 0;
    for delay in RE_ARM_LADDER_MS {
        now += delay;
        supervisor.observe(now, &mut rearm, &mut NoHolds);
    }
    assert_eq!(
        attempts.get(),
        RE_ARM_LADDER_MS.len(),
        "one attempt per rung, no more"
    );
    assert_eq!(
        supervisor.view(now).global,
        GlobalListener::Deaf {
            reason: Some(DeafReason::ListenerParked)
        }
    );
    supervisor.observe(now + 60_000, &mut rearm, &mut NoHolds);
    assert_eq!(
        attempts.get(),
        RE_ARM_LADDER_MS.len(),
        "a parked listener is never retried by itself"
    );
}

#[test]
fn a_parked_listener_rearms_on_the_next_start() {
    let keys = FakeKeys::new((2, 2));
    let mut supervisor = Supervisor::new(
        Box::new(MemoryMarker::default()),
        StopPolicy {
            allow_host_relay_only: false,
        },
    );
    keys.lock().alive = false;
    supervisor.arm(
        Err(omo_computer_core::backend::Refusal::bare(
            omo_computer_core::error::EngineCode::StopPathUnavailable,
        )),
        None,
        0,
    );
    keys.lock().alive = true;
    supervisor.arm(boxed(live(&keys, LeaseEndSignal::default())), None, 10);
    assert_eq!(supervisor.view(10).global, GlobalListener::Fresh);
}
