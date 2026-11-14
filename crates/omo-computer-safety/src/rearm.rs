//! The bounded re-arm ladder of a listener whose liveness lapsed. While it runs the path is
//! `stale` (at most the ladder's sum, 7,750 ms); exhausted, the listener is PARKED and reads
//! deaf until the next `stopPath.start` re-arms it.

use crate::timing::RE_ARM_LADDER_MS;

/// What the ladder does next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReArmStep {
    /// The next attempt is not due.
    Wait,
    /// Try to arm the listener again now.
    Attempt,
    /// Every rung failed.
    Parked,
}

/// One ladder run, started when the listener lapsed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReArm {
    failures: usize,
    since_ms: u64,
    next_at_ms: u64,
}

impl ReArm {
    #[must_use]
    pub const fn begin(now_ms: u64) -> Self {
        Self {
            failures: 0,
            since_ms: now_ms,
            next_at_ms: now_ms + RE_ARM_LADDER_MS[0],
        }
    }

    /// When the path went stale.
    #[must_use]
    pub const fn since_ms(&self) -> u64 {
        self.since_ms
    }

    #[must_use]
    pub const fn step(&self, now_ms: u64) -> ReArmStep {
        if self.failures >= RE_ARM_LADDER_MS.len() {
            ReArmStep::Parked
        } else if now_ms >= self.next_at_ms {
            ReArmStep::Attempt
        } else {
            ReArmStep::Wait
        }
    }

    /// An attempt at `now_ms` failed: the next rung waits its own delay from now.
    pub fn failed(&mut self, now_ms: u64) {
        self.failures += 1;
        if let Some(delay) = RE_ARM_LADDER_MS.get(self.failures) {
            self.next_at_ms = now_ms + delay;
        }
    }
}
