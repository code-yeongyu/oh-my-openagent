//! The quiet window: each event attributed to the window restarts the quiet timer; the watch
//! ends at `quietMs` of silence (`settled`), at the cap (`pending`), or at once when the
//! backend has no observer (`unsupported`). Settled says the tree stopped changing, never that
//! the app finished.

use omo_computer_core::observation::{BusyIndicator, ObservationSettle, SettleOutcome};
use omo_computer_core::settle_profile::{RegimeNumbers, SettleRegime};

use super::feed::Feed;
use super::kinds::is_navigation;

/// The quiet window and the cap of one settle, in milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bounds {
    pub quiet_ms: u64,
    pub cap_ms: u64,
}

impl From<RegimeNumbers> for Bounds {
    fn from(numbers: RegimeNumbers) -> Self {
        Self {
            quiet_ms: numbers.quiet_ms,
            cap_ms: numbers.cap_ms,
        }
    }
}

/// How the regime is picked while the window runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Picking {
    /// A read keeps the regime in force and the bounds it was given.
    Fixed(SettleRegime),
    /// A post-send settle starts `unchanged` and switches on what it sees.
    AfterInput,
}

/// What one settle answered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settled {
    pub outcome: SettleOutcome,
    pub regime: SettleRegime,
    pub quiet_ms: u64,
    pub waited_ms: u64,
    pub indicator: Option<BusyIndicator>,
    /// The kind of the last attributed event: the watch ran on notifications.
    pub last_event: Option<String>,
}

impl Settled {
    /// A backend with no clock or no observer: nothing waited.
    #[must_use]
    pub const fn unsupported(regime: SettleRegime, quiet_ms: u64) -> Self {
        Self {
            outcome: SettleOutcome::Unsupported,
            regime,
            quiet_ms,
            waited_ms: 0,
            indicator: None,
            last_event: None,
        }
    }

    /// The target was still busy at the cap.
    #[must_use]
    pub const fn timeout(
        regime: SettleRegime,
        quiet_ms: u64,
        indicator: BusyIndicator,
        waited_ms: u64,
    ) -> Self {
        Self {
            outcome: SettleOutcome::Timeout,
            regime,
            quiet_ms,
            waited_ms,
            indicator: Some(indicator),
            last_event: None,
        }
    }

    /// The `settle` member of an `Observation` or an `ActionReport`.
    #[must_use]
    pub const fn wire(&self) -> ObservationSettle {
        ObservationSettle {
            outcome: self.outcome,
            indicator: self.indicator,
            quiet_ms: self.quiet_ms,
            waited_ms: self.waited_ms,
            regime: Some(self.regime),
        }
    }
}

/// Waits on `feed` for `window` to go quiet. Events of other windows do not restart the quiet
/// timer; a post-send settle switches to `changed` on the first attributed event and to
/// `navigation` on a navigation event, and never back.
pub fn quiet_window(
    feed: &mut dyn Feed,
    window: &str,
    bounds: Bounds,
    picking: Picking,
) -> Settled {
    let start = feed.now_ms();
    let mut regime = match picking {
        Picking::Fixed(regime) => regime,
        Picking::AfterInput => SettleRegime::Unchanged,
    };
    let mut bounds = bounds;
    let mut last_change = start;
    let mut last_event = None;
    loop {
        let now = feed.now_ms();
        let quiet_end = last_change.saturating_add(bounds.quiet_ms);
        let deadline = start.saturating_add(bounds.cap_ms);
        let ended = if now >= quiet_end {
            Some(SettleOutcome::Settled)
        } else if now >= deadline {
            Some(SettleOutcome::Pending)
        } else {
            None
        };
        // An observer that refuses ends the watch as `unsupported`, with the time it waited.
        let outcome = match ended {
            Some(outcome) => outcome,
            None => match feed.wait_event(quiet_end.min(deadline)) {
                Err(_) => SettleOutcome::Unsupported,
                Ok(Some(event)) if event.window == window => {
                    last_change = feed.now_ms();
                    if picking == Picking::AfterInput {
                        regime = if regime == SettleRegime::Navigation || is_navigation(&event.kind)
                        {
                            SettleRegime::Navigation
                        } else {
                            SettleRegime::Changed
                        };
                        bounds = regime.numbers().into();
                    }
                    last_event = Some(event.kind);
                    continue;
                }
                Ok(_) => continue,
            },
        };
        return Settled {
            outcome,
            regime,
            quiet_ms: bounds.quiet_ms,
            waited_ms: feed.now_ms().saturating_sub(start),
            indicator: None,
            last_event,
        };
    }
}
