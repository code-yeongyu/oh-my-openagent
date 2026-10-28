//! `apps.list` / `apps.open` on macOS (ported from oh-my-pi
//! `desktop/macos/applications.rs` at 0838d2ab44, MIT): the installed and
//! running inventory, a Launch Services open that activates only when asked,
//! and the wait for the opened application's first key-capable window.

mod document;
mod inventory;
mod launch;
mod open;
mod windows;

use senpi_desktop_core::apps;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::protocol_params::{AppsListParams, AppsOpenParams};
use senpi_desktop_core::types::{Application, OpenedApplication};

pub(crate) fn list(params: &AppsListParams) -> CoreResult<Vec<Application>> {
    Ok(apps::filter(inventory::list(&|| Ok(()))?, params))
}

/// Opens what `params` names. The session admitted `activate`/`reveal` under
/// the control grant before this runs; `check_stop` ends the window wait on a
/// stop or a cancel.
pub(crate) fn open(params: &AppsOpenParams, check_stop: &dyn Fn() -> CoreResult<()>) -> CoreResult<OpenedApplication> {
    apps::validate(params)?;
    let listed = inventory::list(check_stop)?;
    let activate = params.activate.unwrap_or(false);
    if apps::route(&listed, params) == apps::Route::Document {
        let app = params
            .app
            .as_deref()
            .map(|app| apps::application(&listed, app, is_helper, inventory::from_path))
            .transpose()?;
        return document::open(&params.id, app, params.reveal.unwrap_or(false), activate, check_stop);
    }
    let app = apps::application(&listed, &params.id, is_helper, inventory::from_path)?;
    open::open(app, activate, check_stop)
}

fn is_helper(app: &Application) -> bool {
    inventory::is_helper(std::path::Path::new(&app.path))
}

#[cfg(test)]
mod tests;
