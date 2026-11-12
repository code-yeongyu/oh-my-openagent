//! The settle stages on the session's call paths: the settle an observe or `waitFor({settle})`
//! runs before its walk, the busy wait before a send, and the post-send settle that picks the
//! regime the next read and send run under.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::observation::{BusyIndicator, SettleOutcome};
use omo_computer_core::requests::SettleSpec;
use omo_computer_core::settle_profile::SettleRegime;

use super::busy::{wait_clear, Busy};
use super::feed::feed;
use super::quiet::{quiet_window, Bounds, Picking, Settled};
use crate::{Refused, Session};

/// `InputBusy{reason:"target_busy"}`: the target was still busy at the regime's cap, and
/// nothing was sent.
pub const TARGET_BUSY: Refusal = Refusal::new(EngineCode::InputBusy, Reason::TargetBusy.wire());

/// What a busy-at-cap exec refusal carries on the wire beside `InputBusy{target_busy}`: the
/// indicator still shown, how long the wait ran, and when the same call may be retried (the cap
/// of the regime in force, the bound a `waitFor({settle})` would wait).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BusyDetail {
    pub indicator: BusyIndicator,
    pub waited_ms: u64,
    pub retry_after_ms: u64,
}

/// The regime the last input's settle picked; before any input, `unchanged`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SettleState {
    pub(crate) regime: SettleRegime,
}

impl Default for SettleState {
    fn default() -> Self {
        Self {
            regime: SettleRegime::Unchanged,
        }
    }
}

/// The bounds of a read: the regime in force, each number overridden by the call's `settle`.
fn read_bounds(regime: SettleRegime, spec: Option<SettleSpec>) -> Bounds {
    let numbers = regime.numbers();
    let spec = spec.unwrap_or_default();
    Bounds {
        quiet_ms: spec.quiet_ms.unwrap_or(numbers.quiet_ms),
        cap_ms: spec.timeout_ms.unwrap_or(numbers.cap_ms),
    }
}

impl Session {
    /// The settle before a read of `window`: the busy wait, then the quiet window. `None` for
    /// the explicit no-wait `{quietMs:0}`. A busy target never refuses a read: at the cap the
    /// settle reads `timeout` with the indicator named.
    pub(crate) fn settle_before_read(
        &mut self,
        window: &str,
        spec: Option<SettleSpec>,
    ) -> Option<Settled> {
        let regime = self.settle.regime;
        let bounds = read_bounds(regime, spec);
        if bounds.quiet_ms == 0 {
            return None;
        }
        let Some(mut feed) = feed(self.backend.as_mut()) else {
            return Some(Settled::unsupported(regime, bounds.quiet_ms));
        };
        let busy_ms = match wait_clear(&mut feed, window, bounds.cap_ms) {
            Busy::Timeout {
                indicator,
                waited_ms,
            } => {
                return Some(Settled::timeout(
                    regime,
                    bounds.quiet_ms,
                    indicator,
                    waited_ms,
                ))
            }
            Busy::Clear { waited_ms } => waited_ms,
        };
        let mut settled = quiet_window(&mut feed, window, bounds, Picking::Fixed(regime));
        settled.waited_ms = settled.waited_ms.saturating_add(busy_ms);
        Some(settled)
    }

    /// The busy wait before a send to `window`, up to the cap of the regime in force.
    ///
    /// # Errors
    /// [`TARGET_BUSY`] with its [`BusyDetail`] when the target is still busy at the cap.
    pub(crate) fn busy_before_send(&mut self, window: Option<&str>) -> Result<(), Refused> {
        let Some(window) = window else {
            return Ok(());
        };
        let cap_ms = self.settle.regime.numbers().cap_ms;
        let Some(mut feed) = feed(self.backend.as_mut()) else {
            return Ok(());
        };
        match wait_clear(&mut feed, window, cap_ms) {
            Busy::Clear { .. } => Ok(()),
            Busy::Timeout {
                indicator,
                waited_ms,
            } => Err(Refused {
                busy: Some(BusyDetail {
                    indicator,
                    waited_ms,
                    retry_after_ms: cap_ms,
                }),
                ..TARGET_BUSY.into()
            }),
        }
    }

    /// The settle after a delivered send to `window`: it picks the regime from what it saw and
    /// keeps it for the next read and send. A send aimed at no window settles nothing.
    pub(crate) fn settle_after_send(&mut self, window: Option<&str>) -> Option<Settled> {
        let window = window?;
        let bounds = Bounds::from(SettleRegime::Unchanged.numbers());
        let Some(mut feed) = feed(self.backend.as_mut()) else {
            return Some(Settled::unsupported(
                SettleRegime::Unchanged,
                bounds.quiet_ms,
            ));
        };
        let settled = quiet_window(&mut feed, window, bounds, Picking::AfterInput);
        drop(feed);
        if settled.outcome != SettleOutcome::Unsupported {
            self.settle.regime = settled.regime;
        }
        Some(settled)
    }
}
