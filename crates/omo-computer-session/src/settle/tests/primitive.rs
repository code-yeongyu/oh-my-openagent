//! The primitive reads only the monotonic clock: a wall-clock step mid-wait moves nothing.

use omo_computer_core::backend::{AxEvent, BackendResult};
use omo_computer_core::observation::{BusyIndicator, SettleOutcome};
use omo_computer_core::settle_profile::SettleRegime;

use crate::settle::{quiet_window, wait_clear, Bounds, Busy, Feed, Picking};

/// A feed whose wall clock jumps an hour at the first wait.
struct Stepping {
    mono: u64,
    wall: u64,
    busy: bool,
}

impl Feed for Stepping {
    fn now_ms(&self) -> u64 {
        self.mono
    }

    fn wait_event(&mut self, until_ms: u64) -> BackendResult<Option<AxEvent>> {
        self.wall += 3_600_000;
        self.mono = self.mono.max(until_ms);
        Ok(None)
    }

    fn busy(&mut self, _window: &str) -> BackendResult<Option<BusyIndicator>> {
        Ok(self.busy.then_some(BusyIndicator::Progress))
    }
}

#[test]
fn wait_is_monotonic_under_wall_clock_step() {
    let bounds = Bounds {
        quiet_ms: 500,
        cap_ms: 1_000,
    };
    let mut feed = Stepping {
        mono: 10_000,
        wall: 0,
        busy: false,
    };
    let settled = quiet_window(
        &mut feed,
        "101",
        bounds,
        Picking::Fixed(SettleRegime::Unchanged),
    );
    assert_eq!(
        (settled.outcome, settled.waited_ms),
        (SettleOutcome::Settled, 500)
    );
    assert_eq!(feed.mono, 10_500);
    assert!(feed.wall >= 3_600_000, "the wall clock stepped mid-wait");
    let mut feed = Stepping {
        mono: 10_000,
        wall: 0,
        busy: true,
    };
    assert_eq!(
        wait_clear(&mut feed, "101", 1_000),
        Busy::Timeout {
            indicator: BusyIndicator::Progress,
            waited_ms: 1_000
        }
    );
    assert_eq!(
        feed.mono, 11_000,
        "the busy wait ends at the cap of monotonic time"
    );
}
