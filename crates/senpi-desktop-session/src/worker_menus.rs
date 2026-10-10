//! Menu requests: `menus.items` is a read against the scripted tree, and
//! `menus.select` is one background-delivered, gated, audited mutation.

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::CoreResult;
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
    /// window id, so the gate, the focus/cursor transaction, and one audit
    /// event apply like every other exec.
    pub(crate) fn menu_select(&mut self, params: &MenuPathParams, cancelled: &dyn Fn() -> bool) -> CoreResult<Audited> {
        validate_path(&params.path, false)?;
        let mutation = Mutation::new(
            MutatingAction::MenuSelect,
            params.window_id.clone(),
            DeliveryMode::Background,
        );
        self.mutate(&mutation, cancelled, |worker| {
            let window = worker.window(&Target::Window(params.window_id.clone()))?;
            worker.backend()?.menu_select(&window, &params.path)?;
            Ok(Response::Unit)
        })
    }
}
