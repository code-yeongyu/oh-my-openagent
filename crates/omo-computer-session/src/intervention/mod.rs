//! User intervention (`design/d-safety.md` '3. Human input detection'). Before a send, the
//! takeover gate holds a call whose target app is frontmost with physical input in it within
//! `TAKEOVER_WINDOW_MS`. During a send, policy `pause` (the engine default) ends the stroke
//! at the next unit boundary once physical input lands in the target, with the exact
//! `delivered{count, of}`; policy `continue` never aborts. A human press is never a stop.

mod admit;
mod display_awake;
mod lease_hook;
mod send;
mod settings;

pub use admit::{Admission, Blocked};
pub use display_awake::{DisplayAwakeHold, HoldLimits, SharedHold};
pub(crate) use lease_hook::with_display_awake;
pub use send::{units, Ended, Outcome, Stop};
pub use settings::OpenSettings;

use omo_computer_core::backend::Backend;
use omo_computer_core::intervention::{
    within_takeover_window, DEFAULT_DISPLAY_AWAKE_GRACE_MS, DEFAULT_DISPLAY_AWAKE_SESSION_CAP_MS,
};
use omo_computer_core::settings::Intervention;

/// The takeover gate: the target app is frontmost and the user touched it within the window.
#[must_use]
pub fn user_active_in_target(backend: &dyn Backend, pid: u32) -> bool {
    let (Some(clock), Some(reads)) = (backend.clock(), backend.intervention()) else {
        return false;
    };
    reads.frontmost_pid() == Some(pid)
        && reads
            .last_user_input_ms(pid)
            .is_some_and(|last| within_takeover_window(last, clock.now_ms()))
}

/// The mid-send watch of one call: physical input in `pid` after `since_ms`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MidSend {
    pub pid: u32,
    pub since_ms: u64,
    pub policy: Intervention,
}

impl MidSend {
    /// Starts watching `pid` from the backend's clock now; `None` when there is no clock.
    #[must_use]
    pub fn start(backend: &dyn Backend, pid: u32, policy: Intervention) -> Option<Self> {
        backend.clock().map(|clock| Self {
            since_ms: clock.now_ms(),
            pid,
            policy,
        })
    }

    /// Whether the stroke ends at this unit boundary.
    #[must_use]
    pub fn intervened(&self, backend: &dyn Backend) -> bool {
        self.policy == Intervention::Pause
            && backend
                .intervention()
                .and_then(|reads| reads.last_user_input_ms(self.pid))
                .is_some_and(|last| last > self.since_ms)
    }
}

impl crate::Session {
    /// The display-awake hold's two settings, with the contract's defaults.
    pub(crate) fn hold_limits(&self) -> HoldLimits {
        self.opened.as_ref().map_or(
            HoldLimits {
                grace_ms: DEFAULT_DISPLAY_AWAKE_GRACE_MS,
                session_cap_ms: DEFAULT_DISPLAY_AWAKE_SESSION_CAP_MS,
            },
            |opened| opened.settings.hold_limits,
        )
    }
}

#[cfg(test)]
mod session_state_tests;
#[cfg(test)]
mod stop_tests;
#[cfg(test)]
mod tests;
