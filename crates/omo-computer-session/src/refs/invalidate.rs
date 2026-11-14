//! The three events that end refs early: a report outside the confirming set marks the window
//! `needs_observe` until a new observation; an epoch change or a changed window identity
//! expires every generation of the window at once. (The first event, a new observe, ages out
//! the ninth generation in `mint`.)

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::report::Effect;

use super::RefRegistry;

/// Why every generation of a window expired at once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Expiry {
    /// `epoch.changed{reason}`: display, lock, sleep, Space or engine restart.
    Epoch,
    /// The window's pid or process start differs.
    IdentityChanged,
}

impl Expiry {
    const fn reason(self) -> Reason {
        match self {
            Self::Epoch => Reason::Epoch,
            Self::IdentityChanged => Reason::IdentityChanged,
        }
    }
}

impl RefRegistry {
    /// A report on `window`: `partial`, `unverifiable`, `suspected_noop` and `refused` mark it
    /// `needs_observe`; `confirmed` and `observed` (and the never-produced `no_change`) leave
    /// its generations valid.
    pub fn after_report(&mut self, window: &str, effect: Effect) {
        match effect {
            Effect::Partial | Effect::Unverifiable | Effect::SuspectedNoop | Effect::Refused => {
                self.after_error(window);
            }
            Effect::Confirmed | Effect::Observed | Effect::NoChange => {}
        }
    }

    /// Any error on `window` marks it `needs_observe`.
    pub fn after_error(&mut self, window: &str) {
        if let Some(refs) = self.windows.get_mut(window) {
            refs.needs_observe = true;
        }
    }

    /// The gate every exec on `window` passes before it sends anything.
    ///
    /// # Errors
    /// `ControlRequired{needs_observe}` until a new observation of the window exists.
    pub fn exec_gate(&self, window: &str) -> Result<(), Refusal> {
        if self.windows.get(window).is_some_and(|refs| refs.needs_observe) {
            return Err(Refusal::new(EngineCode::ControlRequired, Reason::NeedsObserve.wire()));
        }
        Ok(())
    }

    /// Expires every generation of `window`; their refs answer `StaleRef{epoch}` or
    /// `StaleRef{identity_changed}` and no number of theirs carries over.
    pub fn expire(&mut self, window: &str, why: Expiry) {
        let Some(refs) = self.windows.get_mut(window) else { return };
        let released: usize = refs.generations.values().map(|g| g.entries.len()).sum();
        refs.generations.clear();
        refs.by_object.clear();
        refs.by_native_id.clear();
        refs.last_entry.clear();
        refs.needs_observe = false;
        refs.wiped = Some((refs.next_generation + 1, why.reason()));
        self.retained -= released;
    }
}
