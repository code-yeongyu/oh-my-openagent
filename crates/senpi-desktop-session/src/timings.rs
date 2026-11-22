//! Per-stage timings of one mutating request (`trace: true` sessions). The
//! transaction times each stage it runs; the report carries them as
//! [`StageTimings`] in microseconds. Stages the request never reached, and
//! stages no code path runs yet (`prime`), stay absent. `axResolve` is the
//! object-mode actionability battery: the wait before capture plus the
//! immediate check inside `dispatch`.

use std::cell::Cell;
use std::time::Instant;

use senpi_desktop_core::report::StageTimings;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TimedStage {
    AxResolve,
    Capture,
    Dispatch,
    Verify,
    Restore,
}

#[derive(Debug, Default)]
pub(crate) struct StageClock {
    timings: Cell<StageTimings>,
}

impl StageClock {
    pub(crate) const fn new() -> Self {
        Self {
            timings: Cell::new(StageTimings {
                ax_resolve: None,
                capture: None,
                prime: None,
                dispatch: None,
                verify: None,
                restore: None,
            }),
        }
    }

    /// Runs `stage_body`, adding its wall time to `stage`.
    pub(crate) fn time<T>(&self, stage: TimedStage, stage_body: impl FnOnce() -> T) -> T {
        let started = Instant::now();
        let value = stage_body();
        self.add(stage, micros(started));
        value
    }

    fn add(&self, stage: TimedStage, micros: u64) {
        let mut timings = self.timings.get();
        let slot = match stage {
            TimedStage::AxResolve => &mut timings.ax_resolve,
            TimedStage::Capture => &mut timings.capture,
            TimedStage::Dispatch => &mut timings.dispatch,
            TimedStage::Verify => &mut timings.verify,
            TimedStage::Restore => &mut timings.restore,
        };
        *slot = Some(slot.unwrap_or(0).saturating_add(micros));
        self.timings.set(timings);
    }

    pub(crate) fn take(&self) -> StageTimings {
        self.timings.take()
    }
}

fn micros(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_micros()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::{StageClock, TimedStage};

    #[test]
    fn only_the_stages_that_ran_are_reported() {
        // Given
        let clock = StageClock::default();
        // When
        let answer = clock.time(TimedStage::Dispatch, || 42);
        clock.time(TimedStage::Restore, || ());
        let timings = clock.take();
        // Then
        assert_eq!(answer, 42);
        assert!(timings.dispatch.is_some() && timings.restore.is_some());
        assert_eq!((timings.ax_resolve, timings.capture, timings.prime, timings.verify), (None, None, None, None));
    }

    #[test]
    fn a_stage_run_twice_adds_up_and_take_resets() {
        // Given
        let clock = StageClock::default();
        clock.add(TimedStage::Verify, 5);
        clock.add(TimedStage::Verify, 7);
        // When
        let first = clock.take();
        let second = clock.take();
        // Then
        assert_eq!(first.verify, Some(12));
        assert_eq!(second.verify, None);
    }
}
