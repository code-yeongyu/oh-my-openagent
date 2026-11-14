//! The listener slot: the heartbeat window, the deaf listener and the bounded re-arm ladder
//! that parks.

use omo_computer_core::backend::{BackendResult, Refusal, StopListener};
use omo_computer_core::capabilities::{
    DeafReason, StopPathCapability, StopPathKind as CapabilityKind,
};
use omo_computer_core::error::{EngineCode, Reason};

use super::{NoHolds, Supervisor};
use crate::latch::SuspendReason;
use crate::marker::MemoryMarker;
use crate::stop_path::{GlobalListener, StopPathFailure, StopPathKind, StopPolicy};
use crate::timing::RE_ARM_LADDER_MS;

fn local() -> Supervisor {
    Supervisor::new(
        Box::new(MemoryMarker::default()),
        StopPolicy {
            allow_host_relay_only: false,
        },
    )
}

/// A listener whose next polls are scripted.
struct Scripted(Vec<BackendResult<bool>>);

impl StopListener for Scripted {
    fn poll_stop(&mut self) -> BackendResult<bool> {
        if self.0.is_empty() {
            Ok(false)
        } else {
            self.0.remove(0)
        }
    }
}

fn listener(polls: Vec<BackendResult<bool>>) -> BackendResult<Box<dyn StopListener>> {
    Ok(Box::new(Scripted(polls)))
}

fn gone() -> Refusal {
    Refusal::bare(EngineCode::StopPathUnavailable)
}

fn deaf() -> Refusal {
    Refusal::new(EngineCode::StopPathUnavailable, Reason::Deaf.wire())
}

fn never_rearms() -> BackendResult<Box<dyn StopListener>> {
    Err(gone())
}

#[test]
fn the_heartbeat_window_is_2000_ms_and_a_physical_stop_latches() {
    let mut supervisor = local();
    assert_eq!(
        supervisor.view(0).admit(),
        Err(StopPathFailure::NoListener),
        "armed by stopPath.start, never by open"
    );
    supervisor.arm(listener(vec![Ok(false), Ok(true)]), None, 0);
    supervisor.observe(0, &mut never_rearms, &mut NoHolds);
    assert_eq!(supervisor.view(2_000).admit(), Ok(StopPathKind::Global));
    assert_eq!(
        supervisor.view(2_100).admit(),
        Err(StopPathFailure::HeartbeatStale),
        "FakeClock +2100 ms"
    );
    assert_eq!(supervisor.latch(), None);
    supervisor.observe(2_100, &mut never_rearms, &mut NoHolds);
    assert_eq!(
        supervisor.latch(),
        Some(SuspendReason::Hotkey),
        "the physical chord latches"
    );
    assert_eq!(supervisor.stop_epoch(), 1);
}

#[test]
fn a_relay_heartbeat_admits_only_under_the_policy() {
    let mut supervisor = local();
    supervisor.heartbeat(1_000);
    assert_eq!(
        supervisor.view(1_500).admit(),
        Err(StopPathFailure::HostRelayNotAllowed)
    );
    supervisor.set_policy(StopPolicy {
        allow_host_relay_only: true,
    });
    assert_eq!(supervisor.view(1_500).admit(), Ok(StopPathKind::HostRelay));
    assert_eq!(supervisor.status(1_500).stop_path, "host-relay");
    assert_eq!(
        supervisor.view(3_100).admit(),
        Err(StopPathFailure::HeartbeatStale)
    );
}

#[test]
fn stop_path_parked_listener_reads_deaf_and_rearms_on_start() {
    let mut supervisor = local();
    supervisor.set_policy(StopPolicy {
        allow_host_relay_only: true,
    });
    supervisor.arm(listener(vec![Err(gone())]), None, 0);
    supervisor.observe(100, &mut never_rearms, &mut NoHolds);
    assert_eq!(
        supervisor.view(100).global,
        GlobalListener::Stale { since_ms: 100 }
    );
    let attempts = std::cell::Cell::new(0);
    let mut rearm = || {
        attempts.set(attempts.get() + 1);
        never_rearms()
    };
    let mut at = 100;
    for delay in RE_ARM_LADDER_MS {
        at += delay;
        supervisor.observe(at - 1, &mut rearm, &mut NoHolds);
        supervisor.heartbeat(at);
        if at < 100 + RE_ARM_LADDER_MS.iter().sum::<u64>() {
            assert_eq!(
                supervisor.view(at).global,
                GlobalListener::Stale { since_ms: 100 },
                "stale at {at}"
            );
            assert_eq!(
                supervisor.view(at).admit(),
                Ok(StopPathKind::HostRelay),
                "the relay answers while stale"
            );
        }
        supervisor.observe(at, &mut rearm, &mut NoHolds);
    }
    assert_eq!(at - 100, 7_750, "the stale window is bounded by the ladder");
    assert_eq!(attempts.get(), RE_ARM_LADDER_MS.len());
    let parked = supervisor.view(at);
    assert_eq!(
        parked.global,
        GlobalListener::Deaf {
            reason: Some(DeafReason::ListenerParked)
        }
    );
    assert_eq!(
        parked.admit(),
        Err(StopPathFailure::Deaf),
        "parked refuses with the relay on"
    );
    supervisor.set_policy(StopPolicy {
        allow_host_relay_only: false,
    });
    assert_eq!(
        supervisor.view(at).admit(),
        Err(StopPathFailure::Deaf),
        "and with it off"
    );
    assert_eq!(supervisor.status(at).reason.as_deref(), Some("deaf"));
    supervisor.observe(at + 60_000, &mut rearm, &mut NoHolds);
    assert_eq!(
        attempts.get(),
        RE_ARM_LADDER_MS.len(),
        "a parked listener is not re-armed by polling"
    );
    supervisor.arm(listener(Vec::new()), None, at + 60_000);
    assert_eq!(
        supervisor.view(at + 60_000).admit(),
        Ok(StopPathKind::Global),
        "stopPath.start re-arms it"
    );
}

#[test]
fn a_deaf_listener_refuses_under_any_policy_and_recovers_when_it_hears() {
    let mut supervisor = local();
    supervisor.arm(
        listener(vec![Err(deaf()), Err(deaf())]),
        Some(DeafReason::SecureInputActive),
        0,
    );
    supervisor.observe(0, &mut never_rearms, &mut NoHolds);
    supervisor.heartbeat(0);
    for allow in [true, false] {
        supervisor.set_policy(StopPolicy {
            allow_host_relay_only: allow,
        });
        assert_eq!(supervisor.view(0).admit(), Err(StopPathFailure::Deaf));
    }
    assert_eq!(
        supervisor.view(0).global,
        GlobalListener::Deaf {
            reason: Some(DeafReason::SecureInputActive)
        }
    );
    supervisor.observe(10, &mut never_rearms, &mut NoHolds);
    assert_eq!(supervisor.view(10).admit(), Err(StopPathFailure::Deaf));
    supervisor.observe(20, &mut never_rearms, &mut NoHolds);
    assert_eq!(
        supervisor.view(20).admit(),
        Ok(StopPathKind::Global),
        "the next exec lands on the global path"
    );
}

/// `capabilities().stopPath` reads a parked listener as deaf with its reason, and a re-armed
/// one as the live global path; before `stopPath.start` the backend's report stands.
#[test]
fn a_parked_listener_reads_deaf_in_capabilities_stop_path() {
    let backend = StopPathCapability {
        kind: CapabilityKind::Global,
        host_relay_live: false,
        allow_host_relay_only: false,
        listener: "fake".to_owned(),
        deaf: false,
        stale: false,
        deaf_reason: None,
    };
    let mut supervisor = local();
    let mut reported = backend.clone();
    supervisor.describe(0, &mut reported);
    assert_eq!(reported, backend, "unarmed: the backend's report stands");
    supervisor.arm(listener(vec![Err(gone())]), None, 0);
    supervisor.observe(0, &mut never_rearms, &mut NoHolds);
    let mut at = 0;
    for delay in RE_ARM_LADDER_MS {
        at += delay;
        supervisor.observe(at, &mut never_rearms, &mut NoHolds);
    }
    let mut parked = backend.clone();
    supervisor.describe(at, &mut parked);
    assert_eq!(
        (parked.kind, parked.deaf, parked.stale, parked.deaf_reason),
        (
            CapabilityKind::None,
            true,
            false,
            Some(DeafReason::ListenerParked)
        )
    );
    supervisor.arm(listener(Vec::new()), None, at);
    let mut rearmed = parked;
    supervisor.describe(at, &mut rearmed);
    assert_eq!(
        (rearmed.kind, rearmed.deaf, rearmed.deaf_reason),
        (CapabilityKind::Global, false, None)
    );
}
