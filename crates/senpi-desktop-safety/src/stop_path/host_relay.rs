//! The host-relay stop path: the host process that opened the session relays
//! the user's stop (`stopPath.stop`) and beats every
//! [`crate::HEARTBEAT_INTERVAL_MS`] (`stopPath.heartbeat`) while the session
//! is open. It authorizes input alone only under
//! `computer.allowHostRelayOnlyStop`.

use std::sync::Arc;

use super::{Chord, StopPathError, StopPathListener};
use crate::supervisor::{StopPathId, Supervisor};

/// Not live until [`HostRelay::arm`] (or [`StopPathListener::start`]).
#[derive(Default)]
pub struct HostRelay {
    supervisor: Option<Arc<Supervisor>>,
}

impl HostRelay {
    #[must_use]
    pub const fn new() -> Self {
        Self { supervisor: None }
    }

    /// Marks the relay live on `supervisor`. Arming never fails: the relay
    /// needs nothing from the OS.
    pub fn arm(&mut self, supervisor: Arc<Supervisor>) {
        supervisor.set_live(StopPathId::HostRelay, true);
        self.supervisor = Some(supervisor);
    }

    /// The host's heartbeat; ignored until the relay is armed.
    pub fn heartbeat(&self) {
        if let Some(supervisor) = &self.supervisor {
            supervisor.heartbeat(StopPathId::HostRelay);
        }
    }
}

impl StopPathListener for HostRelay {
    fn start(&mut self, _chord: &Chord, sup: Arc<Supervisor>) -> Result<(), StopPathError> {
        self.arm(sup);
        Ok(())
    }

    fn is_live(&self) -> bool {
        self.supervisor
            .as_ref()
            .is_some_and(|supervisor| supervisor.status().host_relay_live)
    }

    fn restart(&mut self) {
        if let Some(supervisor) = &self.supervisor {
            supervisor.set_live(StopPathId::HostRelay, true);
        }
    }
}
