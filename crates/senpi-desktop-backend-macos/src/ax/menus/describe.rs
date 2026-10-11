//! Describing one menu child: title, path, enabled, checked, submenu, and the
//! keyboard shortcut rendered from the AX modifier bits.

use objc2_application_services::AXUIElement;
use objc2_core_foundation::CFNumber;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::menus::MenuItem;

use super::super::element;
use super::walk::{element_pid, required_string, submenu_element};

pub(super) fn describe(element: &AXUIElement, parent: &[String], pid: libc::pid_t) -> CoreResult<MenuItem> {
    if element_pid(element)? != pid {
        return Err(DesktopError::ax_failed("menu item belongs to a different application"));
    }
    let title = required_string(element, "AXTitle")?;
    let mut path = parent.to_vec();
    path.push(title.clone());
    Ok(MenuItem {
        title,
        path,
        enabled: element::copy_bool(element, "AXEnabled").unwrap_or(false),
        checked: element::copy_string(element, "AXMenuItemMarkChar").is_some_and(|mark| !mark.is_empty()),
        has_submenu: submenu_element(element)?.is_some(),
        shortcut: shortcut(element),
    })
}

/// The menu item's keyboard shortcut from `AXMenuItemCmdChar` plus
/// `AXMenuItemCmdModifiers` (Shift=1, Option=2, Control=4, NoCommand=8),
/// rendered like upstream (`Ctrl+Alt+Shift+Cmd+K`).
fn shortcut(element: &AXUIElement) -> Option<String> {
    let key = element::copy_string(element, "AXMenuItemCmdChar").filter(|key| !key.is_empty())?;
    let modifiers = element::copy_attribute(element, "AXMenuItemCmdModifiers")?
        .downcast::<CFNumber>()
        .ok()?
        .as_i64()?;
    render_shortcut(&key, modifiers)
}

pub(super) fn render_shortcut(key: &str, modifiers: i64) -> Option<String> {
    if key.is_empty() {
        return None;
    }
    let mut shortcut = String::new();
    for (enabled, name) in [
        (modifiers & 4 != 0, "Ctrl+"),
        (modifiers & 2 != 0, "Alt+"),
        (modifiers & 1 != 0, "Shift+"),
        (modifiers & 8 == 0, "Cmd+"),
    ] {
        if enabled {
            shortcut.push_str(name);
        }
    }
    shortcut.push_str(key);
    Some(shortcut)
}
