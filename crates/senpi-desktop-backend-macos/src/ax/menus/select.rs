//! Selecting a leaf menu command: re-validating the leaf after the key-window
//! change and pressing it through `AXPress`.

use objc2_application_services::AXUIElement;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::menus::{match_index, require_command, validate_path};
use senpi_desktop_core::types::DesktopWindow;

use super::super::{actions, element};
use super::describe::describe;
use super::walk::{children, context, resolve_menu};

pub(crate) fn select(
    window: &DesktopWindow,
    path: &[String],
    check_stop: &dyn Fn() -> CoreResult<()>,
) -> CoreResult<()> {
    validate_path(path, false)?;
    let (app, pid, wid) = context(window)?;
    let (parents, leaf) = path.split_at(path.len() - 1);
    let (menu, actual_path) = resolve_menu(&app, parents, pid, check_stop)?;
    let (elements, items) = children(&menu, &actual_path, pid, check_stop)?;
    let index = match_index(&items, &leaf[0])?;
    require_command(&items[index])?;
    let element = &elements[index];
    if !has_action(element, "AXPress")? {
        return Err(DesktopError::ax_failed(
            "menu command does not advertise AXPress; nothing was dispatched",
        ));
    }
    // Re-read the leaf: the app may re-validate the command after the key-window change.
    require_command(&describe(element, &actual_path, pid)?)?;
    crate::skylight::activate_without_raise(pid, wid)?;
    require_key_context(pid, wid)?;
    check_stop()?;
    actions::perform(element, "AXPress").map_err(|error| {
        DesktopError::ax_failed(format!(
            "{}; the menu command may already have taken effect; inspect the target before retrying",
            error.message
        ))
    })
}

/// Menu dispatch requires the exact key window; refuse when macOS did not
/// establish that context, so no command fires against the wrong window.
fn require_key_context(pid: libc::pid_t, wid: u32) -> CoreResult<()> {
    let app = element::create_application(pid)?;
    element::set_timeout(&app)?;
    let focused = element::copy_element(&app, "AXFocusedWindow").and_then(|w| element::window_id(&w));
    if focused != Some(wid) {
        return Err(DesktopError::background_unavailable(format!(
            "menu dispatch requires window {wid} to be the exact key window of process {pid}; \
             macOS did not establish that context, so no command was dispatched"
        )));
    }
    Ok(())
}

fn has_action(element: &AXUIElement, action: &str) -> CoreResult<bool> {
    // SAFETY: The slot is writable and receives a create-rule CFArray.
    let names = element::copy_name_array(|slot| unsafe { element.copy_action_names(slot) })
        .map_err(|error| DesktopError::ax_failed(format!("reading the menu item's actions failed ({error:?})")))?;
    Ok(names.iter().any(|name| name == action))
}
