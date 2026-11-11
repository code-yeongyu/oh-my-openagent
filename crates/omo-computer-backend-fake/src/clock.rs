//! The fake clock: its start comes only from `OMO_COMPUTER_FAKE_CLOCK`, and it moves only when
//! a script or a test advances it. The fake never reads the host's time and never waits.

use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// The seam that sets the clock's start.
pub const CLOCK_SEAM: &str = "OMO_COMPUTER_FAKE_CLOCK";

/// Clones share one counter.
#[derive(Debug, Clone, Default)]
pub struct FakeClock {
    millis: Arc<AtomicU64>,
}

/// The seam's value is not a millisecond count.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClockSeamInvalid {
    pub value: String,
}

impl fmt::Display for ClockSeamInvalid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{CLOCK_SEAM}={:?} is not a millisecond count",
            self.value
        )
    }
}

impl std::error::Error for ClockSeamInvalid {}

impl FakeClock {
    /// The clock the seam's value starts; unset starts at 0.
    ///
    /// # Errors
    /// The value is not a whole number of milliseconds.
    pub fn from_seam(value: Option<&str>) -> Result<Self, ClockSeamInvalid> {
        let start = match value {
            None => 0,
            Some(text) => text.trim().parse::<u64>().map_err(|_| ClockSeamInvalid {
                value: text.to_owned(),
            })?,
        };
        Ok(Self {
            millis: Arc::new(AtomicU64::new(start)),
        })
    }

    #[must_use]
    pub fn now_ms(&self) -> u64 {
        self.millis.load(Ordering::SeqCst)
    }

    /// Moves time forward by `ms` (saturating) and returns the new time.
    #[allow(
        clippy::must_use_candidate,
        reason = "advancing is the effect; the new time is optional"
    )]
    pub fn advance(&self, ms: u64) -> u64 {
        let mut previous = self.now_ms();
        loop {
            let next = previous.saturating_add(ms);
            match self.millis.compare_exchange_weak(
                previous,
                next,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => return next,
                Err(actual) => previous = actual,
            }
        }
    }
}

#[cfg(test)]
mod tests;
