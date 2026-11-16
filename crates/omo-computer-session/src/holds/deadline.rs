//! The 100 s bound and the idle stop without a timer thread (R49; review M4 of #13360): while
//! anything is held, the serve loop waits for its next message no longer than one pause tick, and
//! when that wait runs out it calls `release_due_holds`, which polls the stop listener (a hotkey
//! stop releases every hold at once, with no further call) and releases what reached the bound,
//! all through the single post site.

use std::time::Duration;

use omo_computer_core::intervention::PAUSE_TICK_MS;

use crate::Session;

impl Session {
    /// How long the serve loop may wait for input: `None` with nothing held, otherwise until
    /// the oldest hold reaches the bound, and never longer than one pause tick, so a stop
    /// pressed while the session is idle is seen within it.
    #[must_use]
    pub fn hold_wait(&self) -> Option<Duration> {
        let deadline = self.funnel.control.holds.next_deadline()?;
        let until = deadline.saturating_sub(self.clock_ms()).min(PAUSE_TICK_MS);
        Some(Duration::from_millis(until))
    }

    /// The serve loop's idle tick: a latched stop releases every hold (and ends a lease taken
    /// before it); then every hold that reached the bound is released. A later `up` of a
    /// released hold answers `partial`.
    pub fn release_due_holds(&mut self) {
        if self.funnel.control.holds.next_deadline().is_none() {
            return;
        }
        if self.latched().is_some() {
            self.funnel.control.holds.release_all(self.backend.as_mut());
            self.reconcile_stop();
        }
        self.release_expired_holds();
    }

    /// Releases every hold that reached the bound now.
    pub(crate) fn release_expired_holds(&mut self) {
        let now = self.clock_ms();
        self.funnel.control.holds.release_expired(self.backend.as_mut(), now);
    }
}
