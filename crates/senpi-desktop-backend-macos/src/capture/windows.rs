//! Window enumeration through `xcap::Window`.

use std::collections::HashSet;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;
use xcap::Window;

const MIN_WINDOW_EDGE: u32 = 16;
/// `kCGWindowOwnerName` of WindowServer's own overlays (the cursor window),
/// which `screencapture -l` cannot capture.
const WINDOW_SERVER_OWNER: &str = "Window Server";

/// Visible, non-minimized, at-least-16px, titled-or-owned app windows
/// in front-to-back order, deduplicated by id.
pub(crate) fn enumerate() -> CoreResult<Vec<DesktopWindow>> {
    let windows = Window::all().map_err(|error| {
        DesktopError::capture_failed(format!("native window enumeration failed: {error}"))
    })?;
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for window in windows {
        let Ok(id) = window.id() else { continue };
        if !seen.insert(id) || window.is_minimized().unwrap_or(true) {
            continue;
        }
        let (Ok(x), Ok(y), Ok(width), Ok(height)) =
            (window.x(), window.y(), window.width(), window.height())
        else {
            continue;
        };
        if width < MIN_WINDOW_EDGE || height < MIN_WINDOW_EDGE {
            continue;
        }
        let title = window.title().unwrap_or_default();
        let app = window.app_name().unwrap_or_default();
        if (title.is_empty() && app.is_empty()) || app == WINDOW_SERVER_OWNER {
            continue;
        }
        result.push(DesktopWindow {
            id: id.to_string(),
            title,
            app,
            pid: window.pid().ok(),
            x,
            y,
            width,
            height,
            // xcap marks every window of the active app focused; the AX
            // focused window lands with the focus guard (todo 15).
            focused: window.is_focused().unwrap_or(false),
            // xcap cannot report SCWindow.isOnScreen; the SCK capture reply
            // owns the on-Screen truth (B9).
            is_on_screen: None,
            elevated: None,
        });
    }
    let helper_ids = match crate::focus::window_info() {
        Ok(info) => Some(info.iter().filter(|w| w.cursor_overlay).map(|w| w.window_number).collect::<Vec<_>>()),
        Err(error) => {
            eprintln!("window list cannot identify cursor helpers; hiding every title match: {error}");
            None
        }
    };
    super::exclude_overlay_windows(&mut result, helper_ids.as_deref());
    Ok(result)
}

/// The listed window with `id`, or `WindowNotFound`.
pub(crate) fn find(id: &str) -> CoreResult<DesktopWindow> {
    enumerate()?
        .into_iter()
        .find(|window| window.id == id)
        .ok_or_else(|| {
            DesktopError::window_not_found(format!(
                "window '{id}' was not found; it may be closed or minimized"
            ))
        })
}
