//! Idle flush (DESIGN 9, idle shutdown): an object-mode session that served
//! no request for [`IDLE_FLUSH_MS`] drops its frames and refs and announces
//! `epoch.changed{idle_flush}`, like any other epoch move; the session stays
//! open. A null-mode (v1) session is never flushed. Idle time is read on the
//! supervisor's clock, so `$/test.advanceClock` drives it.

use std::time::Duration;

use senpi_desktop_core::protocol_results::EpochReason;
use senpi_desktop_core::report::ReportMode;

use crate::worker::Worker;

/// How long an object-mode session may sit without a request before its
/// frames and refs are flushed.
pub(crate) const IDLE_FLUSH_MS: u64 = 15 * 60 * 1_000;

/// The session's last activity on the supervisor's clock.
#[derive(Debug, Default)]
pub(crate) struct Idle {
    /// When the last request began or ended; `None` before the first open.
    last_ms: Option<u64>,
    /// The current idle stretch was already flushed.
    flushed: bool,
}

impl Idle {
    /// Whether the stretch since the last activity reached the threshold and
    /// was not flushed yet.
    fn due(&self, now_ms: u64) -> bool {
        !self.flushed && self.last_ms.is_some_and(|last| now_ms.saturating_sub(last) >= IDLE_FLUSH_MS)
    }

    fn mark(&mut self, now_ms: u64) {
        self.last_ms = Some(now_ms);
        self.flushed = false;
    }

    /// How long until the flush is due; `None` when there is nothing to wait for.
    fn remaining(&self, now_ms: u64) -> Option<Duration> {
        if self.flushed {
            return None;
        }
        let idle = now_ms.saturating_sub(self.last_ms?);
        Some(Duration::from_millis(IDLE_FLUSH_MS.saturating_sub(idle)))
    }
}

impl Worker {
    /// Counts now as activity: the idle stretch starts over.
    pub(crate) fn mark_active(&mut self) {
        let now = self.safety.supervisor.now_ms();
        self.idle.mark(now);
    }

    /// Flushes frames and refs once per idle stretch; outside object mode the
    /// epoch does not move, so nothing is flushed.
    pub(crate) fn flush_if_idle(&mut self) {
        if !self.idle.due(self.safety.supervisor.now_ms()) {
            return;
        }
        self.idle.flushed = true;
        self.epochs.record(EpochReason::IdleFlush);
        self.apply_epoch();
    }

    /// How long the session thread may wait for a request before it flushes;
    /// `None` outside object mode or once this stretch was flushed.
    pub(crate) fn idle_wait(&self) -> Option<Duration> {
        if self.registry.report_mode() != ReportMode::Object {
            return None;
        }
        self.idle.remaining(self.safety.supervisor.now_ms())
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{Idle, IDLE_FLUSH_MS};

    #[test]
    fn a_stretch_is_due_at_the_threshold_and_only_once() {
        // Given
        let mut idle = Idle::default();
        idle.mark(1_000);
        // Then
        assert!(!idle.due(1_000 + IDLE_FLUSH_MS - 1));
        assert!(idle.due(1_000 + IDLE_FLUSH_MS));
        idle.flushed = true;
        assert!(!idle.due(1_000 + 2 * IDLE_FLUSH_MS));
        assert_eq!(idle.remaining(1_000 + IDLE_FLUSH_MS), None);
        // When: a request arrives
        idle.mark(5_000_000);
        // Then: a new stretch starts
        assert!(!idle.due(5_000_000 + IDLE_FLUSH_MS - 1));
        assert_eq!(idle.remaining(5_000_000 + 60_000), Some(Duration::from_millis(IDLE_FLUSH_MS - 60_000)));
    }

    #[test]
    fn nothing_is_due_before_the_first_open() {
        let idle = Idle::default();
        assert!(!idle.due(u64::MAX));
        assert_eq!(idle.remaining(u64::MAX), None);
    }
}
