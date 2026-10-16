//! Injected millisecond clock. The supervisor never reads time itself, so
//! heartbeat freshness is tested deterministically with [`FakeClock`].

use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Instant,
};

/// Monotonic milliseconds since an arbitrary, fixed origin.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
}

/// Production clock: milliseconds elapsed since construction. Monotonic, so a
/// wall-clock jump can neither freshen nor stale a heartbeat.
#[derive(Debug)]
pub struct MonotonicClock {
    origin: Instant,
}

impl MonotonicClock {
    #[must_use]
    pub fn new() -> Self {
        Self {
            origin: Instant::now(),
        }
    }
}

impl Default for MonotonicClock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock for MonotonicClock {
    fn now_ms(&self) -> u64 {
        u64::try_from(self.origin.elapsed().as_millis()).unwrap_or(u64::MAX)
    }
}

/// Test double: time moves only when [`FakeClock::advance`] is called.
#[derive(Debug)]
pub struct FakeClock {
    now_ms: AtomicU64,
}

impl FakeClock {
    #[must_use]
    pub const fn new(start_ms: u64) -> Self {
        Self {
            now_ms: AtomicU64::new(start_ms),
        }
    }

    pub fn advance(&self, ms: u64) {
        self.now_ms.fetch_add(ms, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.now_ms.load(Ordering::SeqCst)
    }
}
