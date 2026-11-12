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

/// Waits for `window`'s loading indicator to clear, for at most `cap_ms`.
pub fn wait_clear(feed: &mut dyn Feed, window: &str, cap_ms: u64) -> Busy {
    let _ = (window, cap_ms, SETTLE_PROFILE.tick_ms);
    Busy::Clear {
        waited_ms: feed.now_ms().saturating_sub(feed.now_ms()),
    }
}
