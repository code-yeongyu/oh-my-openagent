//! The engine's safety state for one process: the supervisor, the self set and the table,
//! and the one admission call the session makes before every backend input call.

use omo_computer_core::backend::{Backend, BackendResult, Refusal, StopListener, WindowFilter};
use omo_computer_core::capabilities::{DeafReason, StopPathCapability};
use omo_computer_core::listing::WindowInfo;
use omo_computer_core::params::Point;
use omo_computer_core::paths::Roots;
use omo_computer_core::results::{PermissionState, StopPathStatus};
use omo_computer_core::session_state::Tristate;

mod sources;

pub use sources::{Clock, MonotonicClock, OwnProcess, ProcessSource};

use crate::gate::{gate, Admitted, GateFacts, GateRefusal, Tables, Tier, VerbKind};
use crate::latch::SuspendReason;
use crate::marker::{FileMarker, MemoryMarker};
use crate::protected::{Os, ProtectedTable};
use crate::resolve::{resolve, TargetRef};
use crate::self_set::{watch_key, HostAdditions, SelfSet, SelfSetInputs};
use crate::stop_path::{StopPolicy, Transport};
use crate::supervisor::{Holds, NoHolds, StopOutcome, Supervisor};

/// One exec call as the gate sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct Call<'a> {
    pub verb: VerbKind,
    pub target: TargetRef<'a>,
    pub points: Vec<Point>,
    pub chord: Option<String>,
    pub force: bool,
}

/// What the backend reports at the time of the call.
pub struct Observed<F> {
    pub screen_locked: Tristate,
    pub permission: PermissionState,
    /// Read only when gates 1-3 pass.
    pub windows: F,
}

pub struct Guard {
    supervisor: Supervisor,
    source: Box<dyn ProcessSource>,
    clock: Box<dyn Clock>,
    table: &'static ProtectedTable,
    additions: HostAdditions,
    brain_names: Vec<String>,
    allowed_apps: Vec<String>,
    self_set: SelfSet,
    watched: std::collections::BTreeSet<u32>,
}

impl Guard {
    #[must_use]
    pub fn new(
        supervisor: Supervisor,
        source: Box<dyn ProcessSource>,
        clock: Box<dyn Clock>,
    ) -> Self {
        Self {
            supervisor,
            source,
            clock,
            table: ProtectedTable::of(Os::host()),
            additions: HostAdditions::default(),
            brain_names: Vec::new(),
            allowed_apps: Vec::new(),
            self_set: SelfSet::default(),
            watched: std::collections::BTreeSet::new(),
        }
    }

    /// The engine's guard: the `global-stop` marker under the STATE root, brain session locks
    /// under the RUNTIME root, the local loop's stop policy until `session.open` sets one.
    #[must_use]
    pub fn for_roots(roots: &Roots) -> Self {
        let marker = FileMarker::at(roots.stop_marker());
        let supervisor =
            Supervisor::new(Box::new(marker), StopPolicy::default_for(Transport::Local));
        let source = OwnProcess {
            runtime_root: Some(roots.runtime.clone()),
        };
        Self::new(
            supervisor,
            Box::new(source),
            Box::new(MonotonicClock::new()),
        )
    }

    /// A guard whose latch persists only in memory (no STATE root: the self-test, in-process tests).
    #[must_use]
    pub fn in_memory() -> Self {
        let supervisor = Supervisor::new(
            Box::new(MemoryMarker::default()),
            StopPolicy::default_for(Transport::Local),
        );
        Self::new(
            supervisor,
            Box::new(OwnProcess::default()),
            Box::new(MonotonicClock::new()),
        )
    }

    #[must_use]
    pub const fn with_table(mut self, table: &'static ProtectedTable) -> Self {
        self.table = table;
        self
    }

    #[must_use]
    pub fn now_ms(&self) -> u64 {
        self.clock.now_ms()
    }

    #[must_use]
    pub const fn supervisor(&self) -> &Supervisor {
        &self.supervisor
    }

    #[must_use]
    pub const fn self_set(&self) -> &SelfSet {
        &self.self_set
    }

    /// `session.open`: sets the stop policy and the host's additions, computes the self set,
    /// and refuses `Suspended` while the latch (a marker at start, a stop) is set.
    ///
    /// # Errors
    /// `Suspended{reason}` with nothing opened.
    pub fn open(&mut self, policy: StopPolicy, additions: HostAdditions) -> Result<(), Refusal> {
        self.supervisor.set_policy(policy);
        self.additions = additions;
        self.recompute();
        self.supervisor
            .latch()
            .map_or(Ok(()), |latch| Err(latch.refusal()))
    }

    fn recompute(&mut self) {
        let snapshot = self.source.snapshot();
        let locks = self.source.brain_locks();
        self.watched = watch_key(&snapshot, &locks);
        self.self_set = SelfSet::compute(&SelfSetInputs {
            own_pid: std::process::id(),
            snapshot: &snapshot,
            brain_locks: &locks,
            brain_names: &self.brain_names,
            additions: &self.additions,
        });
    }

    /// Recomputes the self set when the sibling-engine / brain list changed.
    fn refresh(&mut self) {
        let key = watch_key(&self.source.snapshot(), &self.source.brain_locks());
        if key != self.watched {
            self.recompute();
        }
    }

    /// `stopPath.start`.
    pub fn start(
        &mut self,
        listener: BackendResult<Box<dyn StopListener>>,
        deaf_reason: Option<DeafReason>,
    ) -> StopPathStatus {
        let now = self.now_ms();
        self.supervisor.arm(listener, deaf_reason, now);
        self.supervisor.status(now)
    }

    /// `stopPath.stop{source}`.
    pub fn stop(
        &mut self,
        source: Option<&str>,
        holds: &mut dyn Holds,
    ) -> (StopOutcome, StopPathStatus) {
        let outcome = self
            .supervisor
            .stop(SuspendReason::from_stop_source(source), holds);
        (outcome, self.supervisor.status(self.now_ms()))
    }

    /// `stopPath.heartbeat`.
    pub fn heartbeat(&mut self) {
        let now = self.now_ms();
        self.supervisor.heartbeat(now);
    }

    #[must_use]
    pub fn status(&self) -> StopPathStatus {
        self.supervisor.status(self.now_ms())
    }

    /// `capabilities().stopPath` with the engine's own stop-path state over the backend's.
    pub fn describe(&self, capability: &mut StopPathCapability) {
        self.supervisor.describe(self.now_ms(), capability);
    }

    /// Polls the stop listener (a physical stop latches here) and runs a due re-arm.
    pub fn observe(
        &mut self,
        rearm: &mut dyn FnMut() -> BackendResult<Box<dyn StopListener>>,
        holds: &mut dyn Holds,
    ) {
        let now = self.now_ms();
        self.supervisor.observe(now, rearm, holds);
    }

    /// `stopPath.start` on `backend`'s listener, polled once so a deaf listener reads deaf.
    pub fn start_on(&mut self, backend: &mut dyn Backend) -> StopPathStatus {
        let deaf_reason = backend.capabilities().stop_path.deaf_reason;
        self.start(backend.stop_listener(), deaf_reason);
        self.observe(&mut || backend.stop_listener(), &mut NoHolds);
        self.status()
    }

    /// The gate for one exec call on `backend`: its listener polled first (a physical stop
    /// latches here), then the eleven gates over what the backend reports.
    ///
    /// # Errors
    /// The first refusing gate, with nothing sent.
    pub fn admit_on(
        &mut self,
        backend: &mut dyn Backend,
        call: &Call<'_>,
    ) -> Result<Admitted, GateRefusal> {
        self.observe(&mut || backend.stop_listener(), &mut NoHolds);
        let observed = Observed {
            screen_locked: backend.capabilities().session.screen_locked,
            permission: backend.probe_permissions().input,
            windows: || {
                backend
                    .windows(&WindowFilter::default())
                    .ok()
                    .map(|list| list.windows)
            },
        };
        self.admit(call, observed)
    }

    /// The gate for one exec call.
    ///
    /// # Errors
    /// The first refusing gate, with nothing sent.
    pub fn admit<F>(
        &mut self,
        call: &Call<'_>,
        observed: Observed<F>,
    ) -> Result<Admitted, GateRefusal>
    where
        F: FnOnce() -> Option<Vec<WindowInfo>>,
    {
        self.refresh();
        let now = self.now_ms();
        let mut facts = GateFacts::clear(Tier::Exec, call.verb, self.supervisor.view(now));
        facts.latch = self.supervisor.latch();
        facts.screen_locked = observed.screen_locked;
        facts.permission = observed.permission;
        facts.chord.clone_from(&call.chord);
        facts.force = call.force;
        let tables = Tables {
            self_set: &self.self_set,
            protected: self.table,
            allowed_apps: &self.allowed_apps,
        };
        let windows = observed.windows;
        gate(&facts, &tables, || {
            resolve(windows().as_deref(), call.target, call.verb, &call.points)
        })
    }
}

#[cfg(test)]
mod tests;
