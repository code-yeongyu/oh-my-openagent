//! Menu requests: `menus.items` is a read against the scripted tree, and
//! `menus.select` is one background-delivered, gated, audited mutation.

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::menus::validate_path;
use senpi_desktop_core::protocol_params::MenuPathParams;
use senpi_desktop_core::types::Target;

use senpi_desktop_safety::MutatingAction;

use crate::mutate::Mutation;
use crate::request::Response;
use crate::worker::{Audited, Worker};

impl Worker {
    /// Listing is a read: the path is validated, then the backend answers
    /// without any mutation transaction or audit event.
    pub(crate) fn menu_items(&mut self, params: &MenuPathParams) -> CoreResult<Response> {
        validate_path(&params.path, true)?;
        let window = self.window(&Target::Window(params.window_id.clone()))?;
        self.backend()?
            .menu_items(&window, &params.path)
            .map(Response::MenuItems)
    }

    /// Selecting a command mutates the app: background delivery against the
    /// window id, so the gate, the key-focus restore, and exactly one audit
    /// event apply like every other exec, an invalid path included. The
    /// backend checks for a stop or cancel at every menu level and before the
    /// press, so a stop landing mid-walk dispatches nothing.
    pub(crate) fn menu_select(&mut self, params: &MenuPathParams, cancelled: &dyn Fn() -> bool) -> CoreResult<Audited> {
        let mutation = Mutation::new(
            MutatingAction::MenuSelect,
            params.window_id.clone(),
            DeliveryMode::Background,
        );
        let supervisor = self.safety.supervisor.clone();
        self.mutate(&mutation, cancelled, |worker| {
            validate_path(&params.path, false)?;
            let window = worker.window(&Target::Window(params.window_id.clone()))?;
            let check_stop = || {
                if supervisor.is_suspended() {
                    Err(DesktopError::new(
                        ErrorCode::Suspended,
                        "input was suspended during the menu walk",
                    ))
                } else if cancelled() {
                    Err(DesktopError::new(
                        ErrorCode::Cancelled,
                        "the request was cancelled during the menu walk",
                    ))
                } else {
                    Ok(())
                }
            };
            worker.backend()?.menu_select(&window, &params.path, &check_stop)?;
            Ok(Response::Unit)
        })
    }
}
