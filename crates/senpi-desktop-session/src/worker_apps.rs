//! `apps.open`: one gated, audited mutation. Opening in the background
//! activates nothing, so it needs no control grant; `activate` or `reveal`
//! bring the application (or Finder) in front, which only this session's live
//! grant admits (plan D5), exactly like `raiseWindow`. Nothing is restored
//! afterwards: a launch that activates itself stays where macOS put it, as in
//! oh-my-pi (Q3).

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::protocol_params::AppsOpenParams;
use senpi_desktop_safety::MutatingAction;

use crate::mutate::Mutation;
use crate::request::Response;
use crate::worker::{Audited, Worker};

impl Worker {
    pub(crate) fn apps_open(&mut self, params: &AppsOpenParams, cancelled: &dyn Fn() -> bool) -> CoreResult<Audited> {
        let foreground = params.takes_foreground();
        let delivery = if foreground { DeliveryMode::Foreground } else { DeliveryMode::Background };
        let mutation = Mutation::new(MutatingAction::OpenApp { foreground }, params.id.clone(), delivery);
        let supervisor = self.safety.supervisor.clone();
        let policy = self.stop_policy();
        self.mutate(&mutation, cancelled, |worker| {
            // Cancellation is read first, so a stop racing it still wins.
            let check_stop = || {
                let is_cancelled = cancelled();
                if supervisor.is_suspended() {
                    Err(DesktopError::new(ErrorCode::Suspended, "input was suspended while the application opened"))
                } else if let Some(stopped) = crate::mutate::interruption(&supervisor, &policy) {
                    Err(stopped)
                } else if is_cancelled {
                    Err(DesktopError::new(ErrorCode::Cancelled, "the request was cancelled while the application opened"))
                } else {
                    Ok(())
                }
            };
            let opened = worker.backend()?.apps_open(params, &check_stop)?;
            Ok(Response::OpenedApplication(opened))
        })
    }
}

#[cfg(test)]
mod tests;
