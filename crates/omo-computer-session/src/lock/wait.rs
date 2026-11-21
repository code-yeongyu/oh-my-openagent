//! A-IS-66 (binding): the interaction lock's wait is bounded and polls. W1: at most
//! `WAIT_BUDGET_MS` (the shipped engine's 2,000 ms), a constant no caller lengthens; W2: a loop of
//! the non-blocking take, a stop check (the caller's, W4), the budget check and a pause of
//! `POLL_MS` on the engine's clock seam; W6: an unusable lock stays A-IS-65 L2's refusal; nothing
//! here breaks, steals, removes, re-creates or ages a lock. One helper beside the lock helper (W8).

use std::time::Instant;

use omo_computer_core::backend::BackendClock;

/// The wait budget (W1).
pub const WAIT_BUDGET_MS: u64 = 2_000;
/// The pause between two takes (W2).
pub const POLL_MS: u64 = 2;

/// The process's monotonic clock, for a backend that has no clock seam.
#[derive(Debug)]
pub(crate) struct MonotonicClock(Instant);

impl Default for MonotonicClock {
    fn default() -> Self {
        Self(Instant::now())
    }
}

impl BackendClock for MonotonicClock {
    fn now_ms(&self) -> u64 {
        u64::try_from(self.0.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    fn wait_ms(&self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

/// One wait for the lock, from the time it began.
#[derive(Debug, Clone, Copy)]
pub(crate) struct LockWait {
    began_ms: u64,
}

impl LockWait {
    pub(crate) const fn began(now_ms: u64) -> Self {
        Self { began_ms: now_ms }
    }

    /// `Some(waited)` once the budget is spent (W3).
    pub(crate) const fn at_bound(self, now_ms: u64) -> Option<u64> {
        let waited = now_ms.saturating_sub(self.began_ms);
        if waited >= WAIT_BUDGET_MS {
            Some(waited)
        } else {
            None
        }
    }
}
