//! The supervisor: the stop latch, the stop listener and the host relay's heartbeat, and the
//! stop commit. It answers gates 1 and 2 and `stopPath.*`.

mod commit;
mod listener;

use omo_computer_core::backend::{BackendResult, StopListener};
use omo_computer_core::capabilities::{
    DeafReason, StopPathCapability, StopPathKind as CapabilityKind,
};
use omo_computer_core::results::StopPathStatus;

pub use commit::{Exit, Holds, NoHolds, ProcessExit, StopOutcome};
use listener::Slot;

use crate::latch::SuspendReason;
use crate::marker::MarkerStore;
use crate::stop_path::{GlobalListener, RelayBeat, StopPathKind, StopPathView, StopPolicy};
use crate::timing::HEARTBEAT_FRESH_MS;

pub struct Supervisor {
    latch: Option<SuspendReason>,
    stop_epoch: u64,
    marker: Box<dyn MarkerStore>,
    policy: StopPolicy,
    slot: Slot,
    relay_beat_ms: Option<u64>,
    exit: Box<dyn Exit>,
}

impl Supervisor {
    /// A supervisor over `marker`: a marker present or unreadable latches `stop_marker`.
    #[must_use]
    pub fn new(marker: Box<dyn MarkerStore>, policy: StopPolicy) -> Self {
        let latch = marker.read().stops().then_some(SuspendReason::StopMarker);
        Self {
            latch,
            stop_epoch: 0,
            marker,
            policy,
            slot: Slot::Unarmed,
            relay_beat_ms: None,
            exit: Box::new(ProcessExit),
        }
    }

    /// Replaces how a failed stop commit ends the process.
    #[must_use]
    pub fn with_exit(mut self, exit: Box<dyn Exit>) -> Self {
        self.exit = exit;
        self
    }

    #[must_use]
    pub const fn latch(&self) -> Option<SuspendReason> {
        self.latch
    }

    #[must_use]
    pub const fn stop_epoch(&self) -> u64 {
        self.stop_epoch
    }

    #[must_use]
    pub const fn policy(&self) -> StopPolicy {
        self.policy
    }

    /// Set at `session.open`.
    pub const fn set_policy(&mut self, policy: StopPolicy) {
        self.policy = policy;
    }

    #[must_use]
    pub fn marker(&self) -> &dyn MarkerStore {
        self.marker.as_ref()
    }

    /// `stopPath.start`: arms (or re-arms a parked) listener. `deaf_reason` is the
    /// backend's declared cause for when the listener reports it cannot hear.
    pub fn arm(
        &mut self,
        listener: BackendResult<Box<dyn StopListener>>,
        deaf_reason: Option<DeafReason>,
        now_ms: u64,
    ) {
        self.slot = Slot::arm(listener, deaf_reason, now_ms);
    }

    /// `stopPath.heartbeat` from the session's host.
    pub const fn heartbeat(&mut self, now_ms: u64) {
        self.relay_beat_ms = Some(now_ms);
    }

    /// Polls the listener (a physical stop commits the stop) and runs a due re-arm.
    pub fn observe(
        &mut self,
        now_ms: u64,
        rearm: &mut dyn FnMut() -> BackendResult<Box<dyn StopListener>>,
        holds: &mut dyn Holds,
    ) {
        if self.slot.poll(now_ms, rearm) {
            self.stop(SuspendReason::Hotkey, holds);
        }
    }

    /// What gate 2 decides on at `now_ms`.
    #[must_use]
    pub fn view(&self, now_ms: u64) -> StopPathView {
        let relay = match self.relay_beat_ms {
            None => RelayBeat::Absent,
            Some(beat) if now_ms.saturating_sub(beat) <= HEARTBEAT_FRESH_MS => RelayBeat::Fresh,
            Some(_) => RelayBeat::Stale,
        };
        StopPathView {
            global: self.slot.global(now_ms),
            relay,
            policy: self.policy,
        }
    }

    /// `capabilities().stopPath` as the engine sees it: the relay and its policy always; once
    /// `stopPath.start` ran, the admitting path and the listener's deaf / stale state (a
    /// parked listener reads `deaf` with `deafReason:"listener-parked"`) replace the
    /// backend's static report.
    pub fn describe(&self, now_ms: u64, capability: &mut StopPathCapability) {
        let view = self.view(now_ms);
        capability.host_relay_live = view.relay == RelayBeat::Fresh;
        capability.allow_host_relay_only = view.policy.allow_host_relay_only;
        if !self.slot.is_armed() {
            return;
        }
        capability.kind = match view.admit() {
            Ok(StopPathKind::Global) => CapabilityKind::Global,
            Ok(StopPathKind::HostRelay) => CapabilityKind::HostRelay,
            Err(_) => CapabilityKind::None,
        };
        capability.stale = matches!(view.global, GlobalListener::Stale { .. });
        (capability.deaf, capability.deaf_reason) = match view.global {
            GlobalListener::Deaf { reason } => (true, reason.or(capability.deaf_reason)),
            _ => (false, None),
        };
    }

    /// The v1 `stopPath.*` reply.
    #[must_use]
    pub fn status(&self, now_ms: u64) -> StopPathStatus {
        let view = self.view(now_ms);
        let admitted = view.admit();
        let reason = match (self.latch, admitted) {
            (Some(latch), _) => latch.refusal().reason,
            (None, Err(failure)) => failure.refusal().reason,
            (None, Ok(_)) => None,
        };
        StopPathStatus {
            suspended: self.latch.is_some(),
            global_live: matches!(view.global, GlobalListener::Fresh),
            host_relay_live: matches!(view.relay, RelayBeat::Fresh),
            heartbeat_fresh: admitted.is_ok(),
            stop_path: admitted.map_or("none", |kind| kind.wire()).to_owned(),
            reason: reason.map(str::to_owned),
        }
    }
}

#[cfg(test)]
mod listener_tests;
#[cfg(test)]
mod tests;
