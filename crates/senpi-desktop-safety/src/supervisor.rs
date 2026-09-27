//! Fail-closed kill-switch supervisor, ported from gajae-code
//! `pi-natives/src/computer/supervisor.rs` and generalized to a registry of
//! stop paths.
//!
//! Side-effecting input may fire only while [`Supervisor::input_allowed`]
//! holds: not suspended, and a live stop path with a fresh heartbeat - the
//! `Global` listener (OS hotkey), or the `HostRelay` alone when the policy
//! opts in (`computer.allowHostRelayOnlyStop`). A stop latches suspension
//! until a user-only [`Supervisor::reset`], which demands a [`UserReset`].
//! A stale heartbeat or a dead listener disables input without suspending.
//!
//! Time comes only from the injected [`Clock`].

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use parking_lot::Mutex;

use crate::{clock::Clock, reset::UserReset};

/// Max age of a stop path's heartbeat before it stops counting (ms).
pub const HEARTBEAT_FRESH_MS: u64 = 2_000;
/// Interval at which a live stop path beats (ms).
pub const HEARTBEAT_INTERVAL_MS: u64 = 500;

/// A registered stop path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StopPathId {
    /// The OS-level hotkey listener.
    Global,
    /// Stop requests relayed by the host process over JSON-RPC.
    HostRelay,
}

/// Who latched suspension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopSource {
    Hotkey,
    HostRelay,
    Api,
}

/// The stop path input currently relies on, as reported in `stopPath`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveStopPath {
    Global,
    HostRelay,
    None,
}

impl ActiveStopPath {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::HostRelay => "host-relay",
            Self::None => "none",
        }
    }
}

/// Which stop paths may authorize input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct StopPolicy {
    /// `computer.allowHostRelayOnlyStop`: accept the host relay without a
    /// live global listener.
    pub allow_host_relay_only: bool,
}

/// Snapshot of supervisor state used for gating and status reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SupervisorStatus {
    /// Input is latched off until a user-only reset.
    pub suspended: bool,
    pub global_live: bool,
    pub host_relay_live: bool,
    /// The heartbeat of [`Self::stop_path`] is within [`HEARTBEAT_FRESH_MS`].
    pub heartbeat_fresh: bool,
    /// The first live and fresh path (`Global` before `HostRelay`), else the
    /// first live one, else `None`.
    pub stop_path: ActiveStopPath,
    /// The source of the stop that latched suspension.
    pub stopped_by: Option<StopSource>,
}

impl SupervisorStatus {
    /// Whether side-effecting input may fire under `policy`.
    #[must_use]
    pub const fn input_allowed(self, policy: &StopPolicy) -> bool {
        if self.suspended || !self.heartbeat_fresh {
            return false;
        }
        match self.stop_path {
            ActiveStopPath::Global => true,
            ActiveStopPath::HostRelay => policy.allow_host_relay_only,
            ActiveStopPath::None => false,
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct StopPathState {
    live: bool,
    last_heartbeat_ms: u64,
}

impl StopPathState {
    const fn fresh_at(self, now_ms: u64) -> bool {
        self.live && now_ms.saturating_sub(self.last_heartbeat_ms) <= HEARTBEAT_FRESH_MS
    }
}

/// Kill-switch state shared by the session loop and every stop path.
pub struct Supervisor {
    suspended: AtomicBool,
    /// Guards every write to `suspended` so the flag and its source agree.
    stopped_by: Mutex<Option<StopSource>>,
    stop_paths: Mutex<HashMap<StopPathId, StopPathState>>,
    clock: Arc<dyn Clock>,
}

impl Supervisor {
    /// Not suspended, no stop path live: input is refused until one registers.
    #[must_use]
    pub fn new(clock: Arc<dyn Clock>) -> Self {
        Self {
            suspended: AtomicBool::new(false),
            stopped_by: Mutex::new(None),
            stop_paths: Mutex::new(HashMap::new()),
            clock,
        }
    }

    /// Record that a stop path is live (or not); going live counts as a beat.
    pub fn set_live(&self, id: StopPathId, live: bool) {
        let now_ms = self.clock.now_ms();
        let mut paths = self.stop_paths.lock();
        let state = paths.entry(id).or_default();
        state.live = live;
        if live {
            state.last_heartbeat_ms = now_ms;
        }
    }

    /// Heartbeat from a stop path, due every [`HEARTBEAT_INTERVAL_MS`].
    pub fn heartbeat(&self, id: StopPathId) {
        let now_ms = self.clock.now_ms();
        self.stop_paths.lock().entry(id).or_default().last_heartbeat_ms = now_ms;
    }

    /// Latch suspension. The first source is kept until [`Self::reset`].
    pub fn trigger_stop(&self, source: StopSource) {
        let mut stopped_by = self.stopped_by.lock();
        stopped_by.get_or_insert(source);
        self.suspended.store(true, Ordering::SeqCst);
    }

    /// Lift suspension. User-only: the proof comes from the host's resume token.
    pub fn reset(&self, _proof: UserReset) {
        let mut stopped_by = self.stopped_by.lock();
        *stopped_by = None;
        self.suspended.store(false, Ordering::SeqCst);
    }

    #[must_use]
    pub fn is_suspended(&self) -> bool {
        self.suspended.load(Ordering::SeqCst)
    }

    #[must_use]
    pub fn status(&self) -> SupervisorStatus {
        let now_ms = self.clock.now_ms();
        let (global, relay) = {
            let paths = self.stop_paths.lock();
            let state = |id| paths.get(&id).copied().unwrap_or_default();
            (state(StopPathId::Global), state(StopPathId::HostRelay))
        };
        let (stop_path, heartbeat_fresh) = if global.fresh_at(now_ms) {
            (ActiveStopPath::Global, true)
        } else if relay.fresh_at(now_ms) {
            (ActiveStopPath::HostRelay, true)
        } else if global.live {
            (ActiveStopPath::Global, false)
        } else if relay.live {
            (ActiveStopPath::HostRelay, false)
        } else {
            (ActiveStopPath::None, false)
        };
        let (suspended, stopped_by) = {
            let stopped_by = self.stopped_by.lock();
            (self.suspended.load(Ordering::SeqCst), *stopped_by)
        };
        SupervisorStatus {
            suspended,
            global_live: global.live,
            host_relay_live: relay.live,
            heartbeat_fresh,
            stop_path,
            stopped_by,
        }
    }

    /// Whether side-effecting input may fire right now under `policy`.
    #[must_use]
    pub fn input_allowed(&self, policy: &StopPolicy) -> bool {
        self.status().input_allowed(policy)
    }
}

#[cfg(test)]
mod tests;
