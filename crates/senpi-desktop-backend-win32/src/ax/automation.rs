//! The UI Automation client: COM initialised once on the session thread, and
//! the entry points that resolve an element from a window, a point, or the
//! keyboard focus.

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;
use uiautomation::types::{Handle, Point};
use uiautomation::{UIAutomation, UIElement, UITreeWalker};

use super::uia_error;

#[derive(Debug, Default)]
pub(super) struct Automation {
    com_initialized: bool,
}

impl Automation {
    /// The first call initialises COM (multithreaded) on the calling thread;
    /// later calls create the client directly, as oh-my-pi does. The client
    /// is not cached: `IUIAutomation` is not `Send`, the backend is.
    fn client(&mut self) -> CoreResult<UIAutomation> {
        if self.com_initialized {
            return UIAutomation::new_direct().map_err(uia_error);
        }
        let client = UIAutomation::new().map_err(uia_error)?;
        self.com_initialized = true;
        Ok(client)
    }

    /// The raw view: every element, not only the control view's subset.
    pub(super) fn walker(&mut self) -> CoreResult<UITreeWalker> {
        self.client()?.get_raw_view_walker().map_err(uia_error)
    }

    /// The element of the window whose id is its HWND.
    pub(super) fn window_root(&mut self, window: &DesktopWindow) -> CoreResult<UIElement> {
        let hwnd = window
            .id
            .parse::<u32>()
            .ok()
            .and_then(|id| isize::try_from(id).ok())
            .ok_or_else(|| DesktopError::ax_failed(format!("invalid Win32 window id '{}'", window.id)))?;
        self.client()?
            .element_from_handle(Handle::from(hwnd))
            .map_err(uia_error)
    }

    /// The element under a physical-pixel point.
    pub(super) fn element_at(&mut self, (x, y): (i32, i32)) -> CoreResult<UIElement> {
        self.client()?
            .element_from_point(Point::new(x, y))
            .map_err(uia_error)
    }

    pub(super) fn focused_element(&mut self) -> CoreResult<UIElement> {
        self.client()?.get_focused_element().map_err(uia_error)
    }
}
