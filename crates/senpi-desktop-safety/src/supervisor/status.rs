//! The supervisor's status snapshot, the one view gating and reporting read.

use std::sync::atomic::Ordering;

use super::{ActiveStopPath, StopPathId, StopPolicy, Supervisor, SupervisorStatus};

impl Supervisor {
    #[must_use]
    pub fn status(&self) -> SupervisorStatus {
        let now_ms = self.clock.now_ms();
        let (global, relay) = {
            let paths = self.stop_paths.lock();
            let state = |id| paths.get(&id).copied().unwrap_or_default();
            (state(StopPathId::Global), state(StopPathId::HostRelay))
        };
        let (global, global_failure) = self.deafness.apply(global, *self.global_failure.lock());
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
            global_failure,
        }
    }

    /// Whether side-effecting input may fire right now under `policy`.
    #[must_use]
    pub fn input_allowed(&self, policy: &StopPolicy) -> bool {
        !self.is_suspended() && self.status().input_allowed(policy)
    }
}
