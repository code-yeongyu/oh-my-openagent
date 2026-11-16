//! Row 50 (R62): the self set reads the backend's own process table when it has one, so a
//! sibling engine's host chain and every TTY owner are in the set; a backend without one leaves
//! the guard's own source (the engine process alone).

use omo_computer_core::backend::{Backend, ProcessTable, Refusal};

use super::Guard;
use crate::self_set::{HostAdditions, ProcessInfo, ProcessSnapshot};
use crate::stop_path::StopPolicy;

impl From<&ProcessTable> for ProcessSnapshot {
    fn from(table: &ProcessTable) -> Self {
        snapshot_of(table)
    }
}

fn snapshot_of(table: &ProcessTable) -> ProcessSnapshot {
    ProcessSnapshot {
        processes: table
            .processes
            .iter()
            .map(|row| ProcessInfo {
                pid: row.pid,
                ppid: row.ppid,
                start: row.start,
                name: row.name.clone(),
                tty: row.tty,
                host_pid: row.host_pid,
                session_leader: row.session_leader,
            })
            .collect(),
        tty_owners: table.tty_owners.clone(),
    }
}

impl Guard {
    pub(super) fn read_processes(&mut self, backend: &dyn Backend) {
        self.backend_processes = backend.processes();
    }

    pub(super) fn snapshot(&self) -> ProcessSnapshot {
        self.backend_processes
            .as_ref()
            .map_or_else(|| self.source.snapshot(), snapshot_of)
    }

    /// [`Guard::open`] with the self set computed from `backend`'s process table.
    ///
    /// # Errors
    /// `Suspended{reason}` with nothing opened.
    pub fn open_on(
        &mut self,
        backend: &dyn Backend,
        policy: StopPolicy,
        additions: HostAdditions,
    ) -> Result<(), Refusal> {
        self.read_processes(backend);
        self.open(policy, additions)
    }
}
