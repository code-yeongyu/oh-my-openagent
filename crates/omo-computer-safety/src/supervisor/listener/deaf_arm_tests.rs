//! A deaf arm or re-arm leaves a deaf slot, so a live relay never admits exec over a listener
//! that cannot hear; every other refusal keeps its slot, and a read still runs.

use omo_computer_core::backend::{BackendResult, Refusal, StopListener};
use omo_computer_core::capabilities::DeafReason;
use omo_computer_core::error::{EngineCode, Reason};

use crate::gate::{gate, GateFacts, Tables, Tier, VerbKind};
use crate::marker::MemoryMarker;
use crate::protected::{Os, ProtectedTable};
use crate::self_set::SelfSet;
use crate::stop_path::{GlobalListener, StopPathFailure, StopPathKind, StopPolicy};
use crate::supervisor::{NoHolds, Supervisor};
use crate::timing::RE_ARM_LADDER_MS;

const RELAY: Result<StopPathKind, StopPathFailure> = Ok(StopPathKind::HostRelay);

fn host_relay_policy() -> Supervisor {
    let policy = StopPolicy {
        allow_host_relay_only: true,
    };
    Supervisor::new(Box::new(MemoryMarker::default()), policy)
}

fn deaf() -> BackendResult<Box<dyn StopListener>> {
    let wire = Reason::Deaf.wire();
    Err(Refusal::new(EngineCode::StopPathUnavailable, wire))
}

fn gone() -> BackendResult<Box<dyn StopListener>> {
    Err(Refusal::bare(EngineCode::StopPathUnavailable))
}

/// A listener whose connection is lost on its first poll.
struct Lost;

impl StopListener for Lost {
    fn poll_stop(&mut self) -> BackendResult<bool> {
        gone().map(|_| false)
    }
}

/// A listener that cannot hear on its first poll and is lost on the next.
#[derive(Default)]
struct DeafThenLost(bool);

impl StopListener for DeafThenLost {
    fn poll_stop(&mut self) -> BackendResult<bool> {
        let polled = std::mem::replace(&mut self.0, true);
        if polled { gone() } else { deaf() }.map(|_| false)
    }
}

/// Gate 2 refuses `StopPathUnavailable{deaf}` with the relay live.
fn refuses_deaf(supervisor: &Supervisor, now: u64) {
    let admit = supervisor.view(now).admit();
    assert_eq!(admit, Err(StopPathFailure::Deaf), "relay live at {now}");
    let refusal = StopPathFailure::Deaf.refusal();
    assert_eq!(refusal.code, EngineCode::StopPathUnavailable);
    assert_eq!(supervisor.status(now).reason.as_deref(), Some("deaf"));
}

#[test]
fn a_deaf_arm_refuses_deaf_under_a_host_relay_policy() {
    let mut supervisor = host_relay_policy();
    supervisor.heartbeat(0);
    supervisor.arm(deaf(), Some(DeafReason::Xi2RawUnavailable), 0);
    refuses_deaf(&supervisor, 0);
    supervisor.observe(10, &mut deaf, &mut NoHolds);
    supervisor.heartbeat(10);
    refuses_deaf(&supervisor, 10);
}

#[test]
fn a_deaf_rearm_refuses_deaf_under_a_host_relay_policy() {
    let mut supervisor = host_relay_policy();
    supervisor.arm(Ok(Box::new(Lost)), None, 0);
    supervisor.observe(0, &mut deaf, &mut NoHolds);
    let at = RE_ARM_LADDER_MS[0];
    supervisor.heartbeat(at);
    assert_eq!(supervisor.view(at).admit(), RELAY, "while re-arming");
    supervisor.observe(at, &mut deaf, &mut NoHolds);
    refuses_deaf(&supervisor, at);
}

#[test]
fn a_refusal_other_than_deaf_keeps_todays_slot() {
    let mut supervisor = host_relay_policy();
    supervisor.heartbeat(0);
    supervisor.arm(gone(), None, 0);
    assert_eq!(supervisor.view(0).admit(), RELAY, "absent");
    supervisor.arm(Ok(Box::new(Lost)), None, 0);
    supervisor.observe(0, &mut gone, &mut NoHolds);
    let at = RE_ARM_LADDER_MS[0];
    supervisor.observe(at, &mut gone, &mut NoHolds);
    supervisor.heartbeat(at);
    assert_eq!(supervisor.view(at).admit(), RELAY, "still re-arming");
}

#[test]
fn a_deaf_arm_still_admits_a_read() {
    let mut supervisor = host_relay_policy();
    supervisor.arm(deaf(), Some(DeafReason::Xi2RawUnavailable), 0);
    let self_set = SelfSet::default();
    let tables = Tables {
        self_set: &self_set,
        protected: ProtectedTable::of(Os::host()),
        allowed_apps: &[],
    };
    let read = GateFacts::clear(Tier::Read, VerbKind::Pointer, supervisor.view(0));
    assert!(gate(&read, &tables, Vec::new).is_ok(), "a read runs");
    let exec = GateFacts::clear(Tier::Exec, VerbKind::Pointer, supervisor.view(0));
    let refused = gate(&exec, &tables, Vec::new).expect_err("exec is refused");
    assert_eq!(refused.refusal.reason, Some("deaf"));
}

/// No listener at all reads absent; a lost armed listener re-arms (stale) and a deaf one stays
/// deaf whatever it answers next, so no other non-deaf refusal reads as a missing seat.
#[test]
fn only_a_missing_seat_reads_absent() {
    let mut supervisor = host_relay_policy();
    supervisor.arm(gone(), None, 0);
    assert_eq!(supervisor.view(0).global, GlobalListener::None, "no seat");
    supervisor.arm(Ok(Box::new(Lost)), None, 0);
    supervisor.observe(5, &mut gone, &mut NoHolds);
    let stale = GlobalListener::Stale { since_ms: 5 };
    assert_eq!(supervisor.view(5).global, stale, "a lost listener");
    supervisor.arm(Ok(Box::new(DeafThenLost::default())), None, 0);
    supervisor.observe(5, &mut gone, &mut NoHolds);
    supervisor.observe(6, &mut gone, &mut NoHolds);
    let deaf = GlobalListener::Deaf { reason: None };
    assert_eq!(supervisor.view(6).global, deaf, "a deaf listener then lost");
}

/// Every failed re-arm before the last rung reads stale, never deaf; only the exhausted ladder
/// parks the listener (deaf, `listener-parked`).
#[test]
fn a_failed_rearm_inside_the_ladder_reads_stale_not_deaf() {
    let mut supervisor = host_relay_policy();
    supervisor.arm(Ok(Box::new(Lost)), None, 0);
    supervisor.observe(0, &mut gone, &mut NoHolds);
    let (rungs, last) = RE_ARM_LADDER_MS.split_at(RE_ARM_LADDER_MS.len() - 1);
    let mut at = 0;
    for delay in rungs {
        at += delay;
        supervisor.observe(at, &mut gone, &mut NoHolds);
        let stale = GlobalListener::Stale { since_ms: 0 };
        assert_eq!(supervisor.view(at).global, stale, "re-arm failed at {at}");
    }
    at += last[0];
    supervisor.observe(at, &mut gone, &mut NoHolds);
    let parked = GlobalListener::Deaf {
        reason: Some(DeafReason::ListenerParked),
    };
    assert_eq!(supervisor.view(at).global, parked, "exhausted");
}
