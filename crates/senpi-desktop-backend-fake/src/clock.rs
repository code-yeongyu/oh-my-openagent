use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Manually advanced millisecond clock for heartbeat and timeout tests.
/// Clones share one counter, so a test advances the clock a supervisor reads.
#[derive(Debug, Clone, Default)]
pub struct FakeClock {
    millis: Arc<AtomicU64>,
}

impl FakeClock {
    pub fn new(start_ms: u64) -> Self {
        Self {
            millis: Arc::new(AtomicU64::new(start_ms)),
        }
    }

    pub fn now_ms(&self) -> u64 {
        self.millis.load(Ordering::SeqCst)
    }

    /// Moves time forward by `ms` (saturating) and returns the new time.
    pub fn advance(&self, ms: u64) -> u64 {
        // An explicit compare-exchange loop: `fetch_update` is deprecated in favour of
        // `try_update` on current stable, and the workspace pins no minimum Rust version.
        let mut previous = self.millis.load(Ordering::SeqCst);
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

    pub fn set(&self, ms: u64) {
        self.millis.store(ms, Ordering::SeqCst);
    }
}
