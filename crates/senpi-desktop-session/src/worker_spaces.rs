//! `window.bringToCurrentSpace`: one gated, audited background mutation. It
//! never activates the window or switches the user's Space, so, as in
//! oh-my-pi, it needs no control grant; the backend checks for a stop or a
//! cancel before the move and while it verifies it.

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_safety::MutatingAction;

use crate::mutate::Mutation;
use crate::request::Response;
use crate::worker::{Audited, Worker};

impl Worker {
    pub(crate) fn bring_to_current_space(
        &mut self,
        window_id: &str,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let mutation = Mutation::new(
            MutatingAction::BringToCurrentSpace,
            window_id.to_owned(),
            DeliveryMode::Background,
        );
        let supervisor = self.safety.supervisor.clone();
        let policy = self.stop_policy();
        self.mutate(&mutation, cancelled, |worker| {
            // Cancellation is read first, so a stop racing it still wins.
            let check_stop = || {
                let is_cancelled = cancelled();
                if supervisor.is_suspended() {
                    Err(DesktopError::new(ErrorCode::Suspended, "input was suspended during the Space move"))
                } else if let Some(stopped) = crate::mutate::interruption(&supervisor, &policy) {
                    Err(stopped)
                } else if is_cancelled {
                    Err(DesktopError::new(ErrorCode::Cancelled, "the request was cancelled during the Space move"))
                } else {
                    Ok(())
                }
            };
            worker.backend()?.bring_to_current_space(window_id, &check_stop)?;
            Ok(Response::Unit)
        })
    }
}

#[cfg(test)]
mod tests;
