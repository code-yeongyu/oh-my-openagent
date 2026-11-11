//! The stop commit: latch first (exec is refused from here on), release every hold within
//! 1 s or exit 1, persist the marker or exit 1, then advance the stop epoch.

use std::sync::mpsc;
use std::time::Duration;

use super::Supervisor;
use crate::latch::SuspendReason;
use crate::timing::STOP_RELEASE_BUDGET_MS;

/// The held input (keys, buttons, in-flight text) a stop must release.
pub trait Holds {
    /// Releases every hold and sends on `done` once all are up; dropping `done` unsent
    /// means a hold could not be released.
    fn release(&mut self, done: mpsc::Sender<()>);
}

/// No hold is outstanding.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoHolds;

impl Holds for NoHolds {
    fn release(&mut self, done: mpsc::Sender<()>) {
        let _ = done.send(());
    }
}

/// How the engine ends when a stop cannot be committed.
pub trait Exit: Send {
    fn exit(&self, code: i32);
}

/// `process::exit`.
#[derive(Debug, Clone, Copy, Default)]
pub struct ProcessExit;

impl Exit for ProcessExit {
    fn exit(&self, code: i32) {
        std::process::exit(code);
    }
}

/// The end of one stop commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopOutcome {
    Committed {
        stop_epoch: u64,
    },
    /// A hold or the marker could not be committed; the engine exited 1.
    Exited,
}

impl Supervisor {
    /// Latches `reason` (an earlier reason stays), releases every hold within the budget and
    /// persists the marker; either failure exits 1.
    pub fn stop(&mut self, reason: SuspendReason, holds: &mut dyn Holds) -> StopOutcome {
        // RED: no release budget and no marker commit yet.
        let _ = (holds, STOP_RELEASE_BUDGET_MS, Duration::ZERO, mpsc::channel::<()>);
        self.latch = Some(self.latch.unwrap_or(reason));
        self.stop_epoch += 1;
        StopOutcome::Committed {
            stop_epoch: self.stop_epoch,
        }
    }
}
