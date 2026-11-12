//! Target liveness (contract acceptance 96). A window whose process exited before admission
//! answers `WindowNotFound` with nothing sent; one that stopped answering answers
//! `InputFailed{app_unresponsive}` with `target{state:"unresponsive"}`; a process that exits
//! during the call ends the send with `target{state:"exited", pid, exitCode}` and
//! `delivery_uncertain/unsafe`. A healthy call carries no `target` member.

use omo_computer_core::backend::{Backend, Refusal};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::intervention::{TargetLiveness, TargetState};

/// The refusal of a window that crashed before admission.
pub const WINDOW_NOT_FOUND: Refusal = Refusal::bare(EngineCode::WindowNotFound);

/// The refusal of a window that stopped answering.
pub const APP_UNRESPONSIVE: Refusal =
    Refusal::new(EngineCode::InputFailed, Reason::AppUnresponsive.wire());

/// `window`'s process has exited.
#[must_use]
pub fn exited(backend: &dyn Backend, window: Option<&str>) -> Option<TargetLiveness> {
    window
        .and_then(|window| backend.intervention()?.target_liveness(window))
        .filter(|liveness| liveness.state == TargetState::Exited)
}

/// `window`'s process stopped answering: the refusal and the `target` member it carries.
#[must_use]
pub fn unresponsive(
    backend: &dyn Backend,
    window: Option<&str>,
) -> Option<(Refusal, TargetLiveness)> {
    window
        .and_then(|window| backend.intervention()?.target_liveness(window))
        .filter(|liveness| liveness.state == TargetState::Unresponsive)
        .map(|liveness| (APP_UNRESPONSIVE, liveness))
}
