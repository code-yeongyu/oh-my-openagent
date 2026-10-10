//! Window enumeration through `xcap::Window`, with every HWND re-validated
//! (`IsWindow`) and each window's owning process checked against the engine's
//! integrity level.

use std::collections::HashSet;
use std::ffi::c_void;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsWindow};
use xcap::Window;

use super::frame::{logical_window_rect, PhysicalRect};
use crate::integrity::{process_elevated, IntegrityRid};

const MAX_LISTED_WINDOWS: usize = 48;
const MIN_WINDOW_EDGE: u32 = 16;

/// Up to 48 live, non-minimized, at-least-16px, titled-or-owned top-level
/// windows in xcap's z-order, deduplicated by HWND, in logical coordinates.
pub(crate) fn enumerate(displays: &[DesktopDisplay], own: IntegrityRid) -> CoreResult<Vec<DesktopWindow>> {
    let windows = Window::all().map_err(|error| {
        DesktopError::capture_failed(format!("Win32 window enumeration query failed: {error}"))
    })?;
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for window in windows {
        if result.len() >= MAX_LISTED_WINDOWS {
            break;
        }
        let Ok(id) = window.id() else { continue };
        if !seen.insert(id) || window.is_minimized().unwrap_or(true) || !is_window(id) {
            continue;
        }
        let (Ok(x), Ok(y), Ok(width), Ok(height)) = (window.x(), window.y(), window.width(), window.height())
        else {
            continue;
        };
        let (x, y, width, height) = logical_window_rect(PhysicalRect { x, y, width, height }, displays);
        if width < MIN_WINDOW_EDGE || height < MIN_WINDOW_EDGE {
            continue;
        }
        let title = window.title().unwrap_or_default();
        let app = window.app_name().unwrap_or_default();
        if title.is_empty() && app.is_empty() {
            continue;
        }
        let pid = process_id(id);
        result.push(DesktopWindow {
            id: id.to_string(),
            title,
            app,
            pid,
            x,
            y,
            width,
            height,
            focused: window.is_focused().unwrap_or(false),
            elevated: pid.and_then(|pid| process_elevated(pid, own)),
        });
    }
    Ok(result)
}

/// The xcap window with HWND `id`, rejecting a stale or foreign id before the
/// capture is attempted.
pub(crate) fn find_native(id: &str) -> CoreResult<Window> {
    let hwnd = id
        .parse::<u32>()
        .map_err(|_| DesktopError::invalid_target(format!("invalid Win32 window id '{id}'")))?;
    let not_found =
        || DesktopError::window_not_found(format!("target window '{id}' was not found; refresh windows()"));
    if !is_window(hwnd) {
        return Err(not_found());
    }
    Window::all()
        .map_err(|error| {
            DesktopError::capture_failed(format!("Win32 window enumeration query failed: {error}"))
        })?
        .into_iter()
        .find(|window| window.id().ok() == Some(hwnd))
        .ok_or_else(not_found)
}

/// xcap's window id is the HWND value; HWNDs are 32-bit significant on every
/// Windows architecture. The handle is an opaque value, never dereferenced.
fn hwnd(id: u32) -> *mut c_void {
    std::ptr::without_provenance_mut(usize::try_from(id).unwrap_or(usize::MAX))
}

fn is_window(id: u32) -> bool {
    // SAFETY: [FFI] `IsWindow` accepts any value and only reports whether it
    // names a live window; no memory is accessed through the handle.
    unsafe { IsWindow(hwnd(id)) != 0 }
}

fn process_id(id: u32) -> Option<u32> {
    let mut pid = 0;
    // SAFETY: [FFI] the HWND came from the current enumeration and passed
    // `IsWindow`; a teardown race makes the call return 0 and leave `pid` 0.
    unsafe { GetWindowThreadProcessId(hwnd(id), &raw mut pid) };
    (pid != 0).then_some(pid)
}
