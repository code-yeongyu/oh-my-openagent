//! The user's holds as the helper's observer thread follows them, readable
//! for a release plan once that thread has applied every transition queued
//! before the stream ended. Ported from oh-my-pi `desktop/macos/release.rs`
//! (MIT).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use super::holds::UserHolds;

/// How long a release plan waits for the observer thread to apply what was
/// queued before the stream ended; past it, the helper releases with the
/// holds as they stand rather than not at all.
const SETTLE_TIMEOUT: Duration = Duration::from_millis(500);

/// The event loop that applies the user's transitions as the tap queues them.
pub(crate) trait Transitions {
    /// Applies the transitions already queued, without waiting for more.
    fn drain(&self);
    /// Applies transitions as they arrive for a short while.
    fn run_briefly(&self);
}

#[derive(Debug, Default, PartialEq, Eq)]
enum Phase {
    /// Not following yet, so no press went to the shared HID route.
    #[default]
    Starting,
    Following,
    /// Every transition queued before the stop is applied.
    Settled,
}

#[derive(Default)]
pub(crate) struct Observation {
    holds: Mutex<UserHolds>,
    phase: Mutex<Phase>,
    stopping: AtomicBool,
    settled: Condvar,
}

impl Observation {
    pub(crate) fn holds(&self) -> MutexGuard<'_, UserHolds> {
        self.holds.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn phase(&self) -> MutexGuard<'_, Phase> {
        self.phase.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Follows the user on the observer thread: applies what queued while the
    /// holds were snapshotted, tells the engine through `ready`, then applies
    /// transitions until [`Self::settle`] asks it to stop, and what queued
    /// until then.
    pub(crate) fn follow(&self, events: &impl Transitions, ready: impl FnOnce()) {
        events.drain();
        *self.phase() = Phase::Following;
        ready();
        while !self.stopping.load(Ordering::Acquire) {
            events.run_briefly();
        }
        events.drain();
        *self.phase() = Phase::Settled;
        self.settled.notify_all();
    }

    /// The user's holds once the observer thread applied every transition
    /// queued before now, or after `SETTLE_TIMEOUT` as they stand. Before the
    /// observer follows they do not matter: nothing went to the HID route.
    pub(crate) fn settle(&self) -> UserHolds {
        self.stopping.store(true, Ordering::Release);
        let phase = self.phase();
        drop(
            self.settled
                .wait_timeout_while(phase, SETTLE_TIMEOUT, |phase| *phase == Phase::Following)
                .unwrap_or_else(PoisonError::into_inner),
        );
        *self.holds()
    }
}
