//! Actions and focus: `perform` by action name through the Action interface,
//! `focus` through Component `GrabFocus`.

use senpi_desktop_core::error::{CoreResult, DesktopError};

use crate::bus::AtSpiBus;

/// The index `perform(action)` invokes: `press` is the element's default
/// (first) action, as in oh-my-pi - GTK buttons list `click` first and a
/// literal `press` action that never releases; anything else is looked up by
/// name, ignoring ASCII case.
fn action_index(names: &[String], action: &str) -> Option<i32> {
    let position = if action.eq_ignore_ascii_case("press") {
        (!names.is_empty()).then_some(0)
    } else {
        names.iter().position(|name| name.eq_ignore_ascii_case(action))
    }?;
    i32::try_from(position).ok()
}

pub(crate) fn perform<B: AtSpiBus>(bus: &mut B, node: &B::Node, action: &str) -> CoreResult<()> {
    let names = bus.actions(node).map_err(DesktopError::ax_failed)?;
    let index = action_index(&names, action)
        .ok_or_else(|| DesktopError::ax_failed(format!("AT-SPI action '{action}' is unavailable")))?;
    if bus.do_action(node, index).map_err(DesktopError::ax_failed)? {
        Ok(())
    } else {
        Err(DesktopError::ax_failed(format!(
            "AT-SPI action '{action}' failed"
        )))
    }
}

pub(crate) fn focus<B: AtSpiBus>(bus: &mut B, node: &B::Node) -> CoreResult<()> {
    if bus.grab_focus(node).map_err(DesktopError::ax_failed)? {
        Ok(())
    } else {
        Err(DesktopError::ax_failed("AT-SPI focus request was rejected"))
    }
}
