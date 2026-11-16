//! Fake time, on request only: the fake's `ready_after_ms` and the
//! actionability battery's wait run on one clock that only the battery's
//! polls move, so a test's timing cannot depend on how busy the host is.

use std::sync::Arc;
use std::time::Duration;

use senpi_desktop_backend_fake::FakeClock as AxClock;
use senpi_desktop_core::types::DesktopSessionOptions;
use serde_json::Value;

use super::Harness;
use crate::actionability::BatteryClock;

/// The battery's time in a fake-time harness: each poll moves it, nothing else.
struct FakeTime(AxClock);

impl BatteryClock for FakeTime {
    fn now(&self) -> Duration {
        Duration::from_millis(self.0.now_ms())
    }

    fn sleep(&self, pause: Duration) {
        self.0
            .advance(u64::try_from(pause.as_millis()).unwrap_or(u64::MAX));
    }
}

/// A harness like [`super::harness_opened`] whose fake measures
/// `ready_after_ms` on a fake clock and whose battery waits on that same clock.
pub(crate) fn harness_on_fake_time(
    overlay: &Value,
    slot: Arc<crate::grant::ControlSlot>,
    options: DesktopSessionOptions,
) -> Harness {
    let clock = AxClock::new(0);
    let mut harness = super::open_with(overlay, slot, options, Some(clock.clone()));
    harness.worker.battery_clock = Box::new(FakeTime(clock));
    harness
}

impl Harness {
    /// The fake time that has passed, in ms; only a fake-time harness has one.
    pub(crate) fn fake_ms(&self) -> u64 {
        self.ax_clock
            .as_ref()
            .map(AxClock::now_ms)
            .expect("fake_ms needs a harness_on_fake_time harness")
    }
}
