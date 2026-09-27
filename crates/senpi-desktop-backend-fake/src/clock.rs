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
        let step = |now: u64| Some(now.saturating_add(ms));
        // `step` always returns `Some`, so `fetch_update` cannot report `Err`;
        // both arms carry the previous value.
        let previous = self
            .millis
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, step)
            .unwrap_or_else(|previous| previous);
        previous.saturating_add(ms)
    }

    pub fn set(&self, ms: u64) {
        self.millis.store(ms, Ordering::SeqCst);
    }
}
