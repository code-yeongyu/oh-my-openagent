//! A live global listener can be unable to hear the stop chord (macOS Secure
//! Event Input hides key events from every event tap). The listener registers
//! a probe, and every status read asks it synchronously, so the gate and each
//! in-flight step see a deaf listener at once rather than at the next
//! heartbeat.

use std::sync::Arc;

use parking_lot::Mutex;

use super::{StopPathFailure, StopPathState, Supervisor};

/// Answers why the global listener cannot hear the chord right now, if it
/// cannot.
pub type DeafProbe = Arc<dyn Fn() -> Option<StopPathFailure> + Send + Sync>;

impl Supervisor {
    /// The latest global listener start result; success clears a previous failure.
    pub fn note_global_failure(&self, failure: Option<StopPathFailure>) {
        *self.global_failure.lock() = failure;
    }

    /// The global listener's deafness probe, read on every status.
    pub fn set_deaf_probe(&self, probe: Option<DeafProbe>) {
        self.deafness.set(probe);
    }
}

#[derive(Default)]
pub(super) struct Deafness(Mutex<Option<DeafProbe>>);

impl Deafness {
    pub(super) fn set(&self, probe: Option<DeafProbe>) {
        *self.0.lock() = probe;
    }

    /// The global path as input may rely on it: a live path that cannot hear
    /// the chord counts as down, and its failure names the cause. A path that
    /// is not live keeps its own failure, so a dead listener is never reported
    /// as merely deaf.
    pub(super) fn apply(
        &self,
        global: StopPathState,
        failure: Option<StopPathFailure>,
    ) -> (StopPathState, Option<StopPathFailure>) {
        if !global.live {
            return (global, failure);
        }
        let probe = self.0.lock().clone();
        match probe.and_then(|probe| probe()) {
            Some(deaf) => (StopPathState { live: false, ..global }, Some(deaf)),
            None => (global, failure),
        }
    }
}
