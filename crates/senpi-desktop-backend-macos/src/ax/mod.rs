//! AXUIElement accessibility backend. Handles wrap `CFRetained<AXUIElement>`
//! in core's session-thread `AxHandle::Native`; refs and generations stay in
//! core's `AxRegistry`.

mod actions;
mod date;
mod foreground;
pub(crate) mod menus;
mod point_owner;
mod popup;
pub(crate) mod element;
mod props;
mod tree;

use senpi_desktop_core::ax::{AxBackend, AxHandle, AxOwner, AxProps};
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::DesktopWindow;

pub use self::element::is_trusted;
pub(crate) use self::foreground::{make_frontmost, prepare_foreground_input};
pub(crate) use self::point_owner::ensure_points_owned;
use self::element::{element, handle};

#[derive(Debug, Default)]
pub struct MacAx;

impl MacAx {
    pub const fn new() -> Self {
        Self
    }

    /// `AXRaise` on the window's AX root; the `raise_window` primitive.
    pub fn raise(&mut self, window: &DesktopWindow) -> CoreResult<()> {
        actions::perform(&*tree::window_root(window)?, "AXRaise")
    }
}

/// Marks `window` main and focused through AX: the belt-and-braces half of
/// `restore_key_focus`.
pub(crate) fn focus_key_window(window: &DesktopWindow) -> CoreResult<()> {
    let root = tree::window_root(window)?;
    actions::set_window_main_and_focused(&root)
}

/// Performs `AXPress` on an element: the canary's deterministic dialog
/// dismissal (synthetic clicks are ignored by these alerts on macOS 26).
pub(crate) fn press(element: &objc2_application_services::AXUIElement) -> CoreResult<()> {
    actions::perform(element, "AXPress")
}

/// Presses `window`'s close button (live-test teardown).
#[cfg(test)]
pub(crate) fn close_window(window: &DesktopWindow) -> CoreResult<()> {
    let root = tree::window_root(window)?;
    let Some(close) = element::copy_element(&root, "AXCloseButton") else {
        return Ok(());
    };
    actions::perform(&close, "press")
}

/// The value of the first `AXTextArea` under `window`'s root (live-test
/// observer over the document text).
#[cfg(test)]
pub(crate) fn text_area_value(window: &DesktopWindow) -> Option<String> {
    let root = tree::window_root(window).ok()?;
    let mut queue = vec![root];
    let mut visited = 0;
    while let Some(element) = queue.pop() {
        visited += 1;
        if visited > 400 {
            return None;
        }
        if element::copy_string(&element, "AXRole").as_deref() == Some("AXTextArea") {
            return element::copy_string(&element, "AXValue");
        }
        queue.extend(element::copy_elements(&element, "AXChildren").unwrap_or_default());
    }
    None
}


impl AxBackend for MacAx {
    fn window_root(&mut self, win: &DesktopWindow) -> CoreResult<AxHandle> {
        tree::window_root(win).map(handle)
    }

    fn props(&mut self, h: &AxHandle) -> CoreResult<AxProps> {
        props::read_props(element(h)?)
    }

    fn children(&mut self, h: &AxHandle) -> CoreResult<Vec<AxHandle>> {
        Ok(tree::children(element(h)?).into_iter().map(handle).collect())
    }

    fn parent(&mut self, h: &AxHandle) -> CoreResult<Option<AxHandle>> {
        Ok(tree::parent(element(h)?).map(handle))
    }

    fn perform(&mut self, h: &AxHandle, action: &str) -> CoreResult<()> {
        actions::perform(element(h)?, action)
    }

    fn set_value(&mut self, h: &AxHandle, value: &str) -> CoreResult<()> {
        actions::set_value(element(h)?, value)
    }

    fn focus(&mut self, h: &AxHandle) -> CoreResult<()> {
        actions::focus(element(h)?)
    }

    fn element_at(&mut self, x: f64, y: f64) -> CoreResult<Option<AxHandle>> {
        tree::element_at(x, y).map(|found| found.map(handle))
    }

    fn focused_element(&mut self) -> CoreResult<Option<AxHandle>> {
        tree::focused_element().map(|found| found.map(handle))
    }

    fn attributes(&mut self, h: &AxHandle) -> CoreResult<Vec<(String, String)>> {
        tree::attributes(element(h)?)
    }

    /// `AXWindow`'s CGWindowID: the id `windows()` lists.
    fn owner(&mut self, h: &AxHandle, _windows: &[DesktopWindow]) -> CoreResult<AxOwner> {
        Ok(element::owner_window_id(element(h)?)
            .map_or(AxOwner::Unknown, |id| AxOwner::Window(id.to_string())))
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod live_tests;
