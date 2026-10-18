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
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Weak,
    },
};

use parking_lot::Mutex;

use crate::{clock::Clock, reset::UserReset};

mod stop;
mod emergency;

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

/// Why the global stop-chord listener failed to start; the gate turns
/// `AccessibilityDenied` into a permission error instead of a missing stop path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopPathFailure {
    Unavailable,
    AccessibilityDenied,
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
    pub global_failure: Option<StopPathFailure>,
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
    #[cfg(any(test, feature = "test-support"))]
    hold_waiting: Mutex<Option<std::sync::mpsc::Sender<()>>>,
    hold_signals: Mutex<Vec<Weak<crate::HoldSignal>>>,
    suspended: AtomicBool,
    published: AtomicBool,
    stop_commit_lock: Mutex<()>,
    emergency: Mutex<Option<emergency::EmergencyWorker>>,
    bounded_release: AtomicBool,
    fatal_exit: Arc<dyn Fn(i32) + Send + Sync>,
    /// Bumped by every stop, so a control grant granted before one is dead.
    stop_epoch: AtomicU64,
    /// Guards every write to `suspended` so the flag and its source agree.
    stopped_by: Mutex<Option<StopSource>>,
    stop_paths: Mutex<HashMap<StopPathId, StopPathState>>,
    global_failure: Mutex<Option<StopPathFailure>>,
    clock: Arc<dyn Clock>,
    stop_commit: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl Supervisor {
    /// Not suspended, no stop path live: input is refused until one registers.
    #[must_use]
    pub fn new(clock: Arc<dyn Clock>) -> Self {
        Self {
            #[cfg(any(test, feature = "test-support"))]
            hold_waiting: Mutex::new(None),
            hold_signals: Mutex::new(Vec::new()),
            suspended: AtomicBool::new(false),
            published: AtomicBool::new(false),
            stop_commit_lock: Mutex::new(()),
            emergency: Mutex::new(None),
            bounded_release: AtomicBool::new(false),
            fatal_exit: Arc::new(|code| std::process::exit(code)),
            stop_epoch: AtomicU64::new(0),
            stopped_by: Mutex::new(None),
            stop_paths: Mutex::new(HashMap::new()),
            global_failure: Mutex::new(None),
            clock,
            stop_commit: None,
        }
    }

    /// A durable owner restores state before sharing this supervisor. The
    /// commit callback must return only after persistence succeeds; on failure
    /// its owner must fail closed rather than return and acknowledge the stop.
    #[must_use]
    pub fn with_stop_commit(
        clock: Arc<dyn Clock>,
        stopped: bool,
        commit: impl Fn() + Send + Sync + 'static,
    ) -> Self {
        let mut supervisor = Self::new(clock);
        supervisor.stop_commit = Some(Arc::new(commit));
        supervisor.bounded_release.store(true, Ordering::SeqCst);
        if stopped {
            supervisor.suspended.store(true, Ordering::SeqCst);
            supervisor.published.store(true, Ordering::SeqCst);
            supervisor.stop_epoch.store(1, Ordering::SeqCst);
            *supervisor.stopped_by.get_mut() = Some(StopSource::Api);
        }
        supervisor
    }

    /// The latest global listener start result; success clears a previous failure.
    pub fn note_global_failure(&self, failure: Option<StopPathFailure>) {
        *self.global_failure.lock() = failure;
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

    /// Register before checking state or pressing input. Weak registration
    /// cannot keep a completed request alive; dead registrations are pruned.
    #[must_use]
    pub fn hold_signal(&self) -> Arc<crate::HoldSignal> {
        let signal = crate::HoldSignal::new(self.stop_epoch());
        let mut signals = self.hold_signals.lock();
        signals.retain(|signal| signal.strong_count() > 0);
        signals.push(Arc::downgrade(&signal));
        signal
    }

    /// Observe the next hold's atomic park. The notification is sent while
    /// holding the wait mutex: cancel/stop cannot acquire it until wait_for
    /// has atomically parked and unlocked, so their notification cannot race.
    #[cfg(any(test, feature = "test-support"))]
    pub fn subscribe_hold_wait_for_test(&self) -> std::sync::mpsc::Receiver<()> {
        let (sender, receiver) = std::sync::mpsc::channel();
        *self.hold_waiting.lock() = Some(sender);
        receiver
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(crate) fn hold_waiting_for_test(&self) {
        if let Some(sender) = self.hold_waiting.lock().take() {
            sender.send(()).unwrap_or(());
        }
    }

    /// How many stops this supervisor observed; a control grant's epoch at
    /// grant time is how the session tells a later stop happened.
    #[must_use]
    pub fn stop_epoch(&self) -> u64 {
        self.stop_epoch.load(Ordering::SeqCst)
    }

    /// Lift suspension. User-only: the proof comes from the host's resume token.
    pub fn reset(&self, _proof: UserReset) {
        let _commit = self.stop_commit_lock.lock();
        let mut stopped_by = self.stopped_by.lock();
        *stopped_by = None;
        self.published.store(false, Ordering::SeqCst);
        self.suspended.store(false, Ordering::SeqCst);
    }

    #[must_use]
    pub fn is_suspended(&self) -> bool {
        self.suspended.load(Ordering::SeqCst)
    }

    /// Lifts suspension without a [`UserReset`], for tests only: compiled
    /// solely with the `test-support` feature, which only dev-dependencies
    /// enable, so no production build can call it.
    #[cfg(any(test, feature = "test-support"))]
    pub fn reset_for_test(&self) {
        let _commit = self.stop_commit_lock.lock();
        let mut stopped_by = self.stopped_by.lock();
        *stopped_by = None;
        self.published.store(false, Ordering::SeqCst);
        self.suspended.store(false, Ordering::SeqCst);
    }

    /// Replaces the deadline-exceeded process exit, for tests only, so a slow
    /// test machine records the fatal path instead of killing the test binary.
    #[cfg(any(test, feature = "test-support"))]
    pub fn set_fatal_exit_for_test(&mut self, exit: impl Fn(i32) + Send + Sync + 'static) {
        self.fatal_exit = Arc::new(exit);
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
            global_failure: *self.global_failure.lock(),
        }
    }

    /// Whether side-effecting input may fire right now under `policy`.
    #[must_use]
    pub fn input_allowed(&self, policy: &StopPolicy) -> bool {
        !self.is_suspended() && self.status().input_allowed(policy)
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
#[path = "supervisor/persistence_tests.rs"]
mod persistence_tests;

#[cfg(test)]
mod stop_timeout_tests;

#[cfg(test)]
mod emergency_tests;
