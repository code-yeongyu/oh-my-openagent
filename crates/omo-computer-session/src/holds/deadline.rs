//! The 100 s bound without a timer thread (R49): the serve loop waits for its next message
//! no longer than `hold_wait`, and when that wait runs out it calls `release_due_holds`, which
//! releases what reached the bound through the single post site.

use std::time::Duration;

use crate::Session;

impl Session {
    /// How long the serve loop may wait for input before a hold reaches the bound; `None`
    /// with nothing held.
    #[must_use]
    pub fn hold_wait(&self) -> Option<Duration> {
        let deadline = self.funnel.control.holds.next_deadline()?;
        Some(Duration::from_millis(deadline.saturating_sub(self.clock_ms())))
    }

    /// Releases every hold that reached the bound; a later `up` of one answers `partial`.
    pub fn release_due_holds(&mut self) {
        let now = self.clock_ms();
        self.funnel.control.holds.release_expired(self.backend.as_mut(), now);
    }
}
