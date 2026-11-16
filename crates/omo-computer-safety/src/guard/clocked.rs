//! The guard over another clock: the engine installs the fake's clock when the fake-clock seam
//! is set (row 28), so the stop path's heartbeat ages with `$/test.advanceClock`, not wall time.

use super::sources::Clock;
use super::Guard;

impl Guard {
    #[must_use]
    pub fn with_clock(mut self, clock: Box<dyn Clock>) -> Self {
        self.clock = clock;
        self
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    use super::*;

    struct Shared(Arc<AtomicU64>);

    impl Clock for Shared {
        fn now_ms(&self) -> u64 {
            self.0.load(Ordering::SeqCst)
        }
    }

    #[test]
    fn the_guard_reads_the_clock_it_is_given() {
        let time = Arc::new(AtomicU64::new(7));
        let guard = Guard::in_memory().with_clock(Box::new(Shared(Arc::clone(&time))));
        assert_eq!(guard.now_ms(), 7);
        time.store(2_107, Ordering::SeqCst);
        assert_eq!(guard.now_ms(), 2_107);
    }
}
