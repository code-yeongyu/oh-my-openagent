//! The clock a scripted tree measures `ready_after_ms` on.

use std::time::{Duration, Instant};

use crate::clock::FakeClock;

/// The clock `ready_after_ms` is measured on: the host's by default, or a
/// [`FakeClock`] that only a test moves.
#[derive(Debug, Clone)]
pub(crate) enum AxTime {
    Host(Instant),
    Fake(FakeClock),
}

impl Default for AxTime {
    fn default() -> Self {
        Self::Host(Instant::now())
    }
}

impl AxTime {
    pub(crate) fn now(&self) -> Duration {
        match self {
            Self::Host(origin) => origin.elapsed(),
            Self::Fake(clock) => Duration::from_millis(clock.now_ms()),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::AxTime;
    use crate::clock::FakeClock;

    #[test]
    fn fake_time_is_exactly_the_fake_clock_with_no_host_time_added() {
        // Given: a fake clock, moved only by the test.
        let clock = FakeClock::new(0);
        let time = AxTime::Fake(clock.clone());
        // When / Then: every read equals the clock to the nanosecond, so host
        // time can be neither the source nor an addend.
        assert_eq!(time.now(), Duration::ZERO);
        clock.advance(500);
        assert_eq!(time.now(), Duration::from_millis(500));
        assert_eq!(time.now(), Duration::from_millis(500));
    }
}
