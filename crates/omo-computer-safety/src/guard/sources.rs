//! The clock and the process source the guard reads.

use std::path::PathBuf;
use std::time::Instant;

use crate::self_set::{read_brain_locks, BrainLock, ProcessInfo, ProcessSnapshot};

/// Milliseconds on a monotonic clock.
pub trait Clock: Send {
    fn now_ms(&self) -> u64;
}

/// The process's monotonic clock, from its creation.
#[derive(Debug, Clone, Copy)]
pub struct MonotonicClock(Instant);

impl MonotonicClock {
    #[must_use]
    pub fn new() -> Self {
        Self(Instant::now())
    }
}

impl Default for MonotonicClock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock for MonotonicClock {
    fn now_ms(&self) -> u64 {
        u64::try_from(self.0.elapsed().as_millis()).unwrap_or(u64::MAX)
    }
}

/// Where the self set's processes come from: a per-OS reader, or (until it exists) the engine
/// process alone plus the brain lock files under the RUNTIME root.
pub trait ProcessSource: Send {
    fn snapshot(&self) -> ProcessSnapshot;
    fn brain_locks(&self) -> Vec<BrainLock>;
}

/// The engine's own process, with no ancestry, and the lock files under `runtime_root`.
#[derive(Debug, Clone, Default)]
pub struct OwnProcess {
    pub runtime_root: Option<PathBuf>,
}

impl ProcessSource for OwnProcess {
    fn snapshot(&self) -> ProcessSnapshot {
        ProcessSnapshot {
            processes: vec![ProcessInfo {
                pid: std::process::id(),
                ppid: 0,
                start: 0,
                name: String::new(),
                tty: None,
                host_pid: None,
                session_leader: true,
            }],
            tty_owners: Vec::new(),
        }
    }

    fn brain_locks(&self) -> Vec<BrainLock> {
        self.runtime_root
            .as_deref()
            .map(read_brain_locks)
            .unwrap_or_default()
    }
}
