//! Menu-bar traversal over AXUIElement: listing the children of a window's
//! menu at a path and pressing a leaf command through core's shared matcher.
//!
//! Application menus dispatch through the key window, so `select` makes the
//! window key without raising it first; the session's key-focus guard owns
//! restoring the user's keyboard context afterwards.

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::DesktopWindow;

/// The immediate children of `window`'s menu at `path` (empty = the menu bar).
pub(crate) fn items(_window: &DesktopWindow, _path: &[String]) -> CoreResult<Vec<senpi_desktop_core::menus::MenuItem>> {
    todo!("implemented by the B2b implementation commit")
}

/// Invokes the leaf command `path` names in `window`'s menu.
pub(crate) fn select(
    _window: &DesktopWindow,
    _path: &[String],
    _check_stop: &dyn Fn() -> CoreResult<()>,
) -> CoreResult<()> {
    todo!("implemented by the B2b implementation commit")
}

#[cfg(test)]
mod tests;
