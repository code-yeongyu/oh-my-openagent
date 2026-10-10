//! Menu-bar traversal over AXUIElement: listing the children of a window's
//! menu at a path and pressing a leaf command through core's shared matcher.
//!
//! Application menus dispatch through the key window, so `select` makes the
//! window key without raising it first; the session's key-focus guard owns
//! restoring the user's keyboard context afterwards.

mod describe;
mod select;
mod walk;

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::menus::{validate_path, MenuItem};
use senpi_desktop_core::types::DesktopWindow;

pub(crate) use self::select::select;

#[cfg(test)]
use self::describe::render_shortcut;
#[cfg(test)]
use self::walk::{submenu_child, SubmenuNode};

/// The immediate children of `window`'s menu at `path` (empty = the menu bar).
pub(crate) fn items(window: &DesktopWindow, path: &[String]) -> CoreResult<Vec<MenuItem>> {
    validate_path(path, true)?;
    let (app, pid, _) = walk::context(window)?;
    let (menu, actual_path) = walk::resolve_menu(&app, path, pid, &|| Ok(()))?;
    let (_, items) = walk::children(&menu, &actual_path, pid, &|| Ok(()))?;
    Ok(items)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod live_tests;
