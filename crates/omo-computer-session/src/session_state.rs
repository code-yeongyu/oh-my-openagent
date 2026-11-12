//! The `SessionState` sampler and its policy table (`design/d-safety.md` '5. Screen lock and
//! secure desktop'; contract acceptance 77, 78). Only the lock and a local suspend hold an
//! admission; display sleep and a deactivated session refuse the FOREGROUND route only; the
//! screen saver reports. A field that reads `"unknown"` never refuses and never pauses.

use omo_computer_core::backend::{Backend, Refusal, Route};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::intervention::PauseReason;
use omo_computer_core::session_state::{SessionPauseReason, SessionState, Tristate};

/// The session state the backend's probes read now (over its capability vector's), stamped
/// with its sample time.
#[must_use]
pub fn sample(backend: &dyn Backend) -> SessionState {
    backend
        .intervention()
        .and_then(|reads| reads.session_state())
        .unwrap_or_else(|| backend.capabilities().session)
}

const fn is_true(field: Tristate) -> bool {
    matches!(field, Tristate::Known(true))
}

const fn is_false(field: Tristate) -> bool {
    matches!(field, Tristate::Known(false))
}

/// What the session state holds an exec admission for: the lock, then a local suspend.
#[must_use]
pub fn hold(state: &SessionState) -> Option<PauseReason> {
    if is_true(state.screen_locked) {
        return Some(PauseReason::ScreenLocked);
    }
    state
        .pause_reasons
        .contains(&SessionPauseReason::SystemSuspended)
        .then_some(PauseReason::SystemSuspended)
}

/// The refusal a call on `route` reads under `state`, after the lock stage admitted it: a
/// deactivated session, then a sleeping display, refuse the foreground route only.
#[must_use]
pub fn route_refusal(state: &SessionState, route: Route) -> Option<Refusal> {
    if route != Route::ForegroundHid {
        return None;
    }
    if is_false(state.session_active) {
        return Some(Refusal::new(
            EngineCode::SessionInactive,
            Reason::SessionDeactivated.wire(),
        ));
    }
    is_true(state.display_asleep)
        .then(|| Refusal::new(EngineCode::ControlRequired, Reason::DisplayAsleep.wire()))
}

/// The typed end of a hold that outlasted the pause ceiling.
#[must_use]
pub fn ceiling_refusal(reason: PauseReason) -> Refusal {
    match reason {
        PauseReason::UserActive => Refusal::bare(EngineCode::UserIntervened),
        PauseReason::ScreenLocked => {
            Refusal::new(EngineCode::ScreenLocked, Reason::ScreenLocked.wire())
        }
        PauseReason::SystemSuspended => Refusal::new(
            EngineCode::SessionInactive,
            Reason::SystemSuspended.wire(),
        ),
    }
}

