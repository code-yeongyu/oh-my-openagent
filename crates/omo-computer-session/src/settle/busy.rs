//! The loading-indicator wait (amendment A4): a busy target is waited for on the event feed,
//! its indicator re-read every sampling tick, up to the cap of the regime in force and never
//! longer.

use omo_computer_core::observation::BusyIndicator;
use omo_computer_core::settle_profile::SETTLE_PROFILE;

use super::feed::Feed;

/// How the busy wait ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Busy {
    /// The target shows no indicator, or the backend cannot read one.
    Clear { waited_ms: u64 },
    /// Still busy at the cap.
    Timeout {
        indicator: BusyIndicator,
        waited_ms: u64,
    },
}

/// Waits for `window`'s loading indicator to clear, for at most `cap_ms` on the monotonic
/// clock, re-reading it every sampling tick and on every observer event.
pub fn wait_clear(feed: &mut dyn Feed, window: &str, cap_ms: u64) -> Busy {
    let start = feed.now_ms();
    let deadline = start.saturating_add(cap_ms);
    loop {
        let now = feed.now_ms();
        let waited_ms = now.saturating_sub(start);
        // A backend that cannot read the indicator cannot hold the call: it reads as clear.
        let Ok(Some(indicator)) = feed.busy(window) else {
            return Busy::Clear { waited_ms };
        };
        if now >= deadline {
            return Busy::Timeout {
                indicator,
                waited_ms,
            };
        }
        let tick = now.saturating_add(SETTLE_PROFILE.tick_ms).min(deadline);
        // Without an observer the wait cannot move on: the target stays busy.
        if feed.wait_event(tick).is_err() {
            return Busy::Timeout {
                indicator,
                waited_ms,
            };
        }
    }
}
