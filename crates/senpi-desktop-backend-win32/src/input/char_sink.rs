//! The text sink of a background window. A thread Win32 deactivated has no
//! focus window, so the control a posted `WM_CHAR` must reach is found by
//! the Win32 dialog contract instead: a control that processes `WM_CHAR`
//! answers `WM_GETDLGCODE` with `DLGC_WANTCHARS` (an edit control does; a
//! button or a status bar does not). Only an unambiguous sink is used.

use windows_sys::Win32::UI::Input::KeyboardAndMouse::IsWindowEnabled;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    FindWindowExW, IsWindowVisible, SendMessageTimeoutW, DLGC_WANTCHARS, SMTO_ABORTIFHUNG, WM_GETDLGCODE,
};

use super::native::Window;

/// Bounds the descendant walk of a pathological window tree.
const MAX_WINDOWS: usize = 512;
/// A hung control counts as no sink rather than stalling the input.
const DLGCODE_TIMEOUT_MS: u32 = 200;

/// The only visible, enabled descendant of `window` that processes
/// `WM_CHAR`; `None` when there is none or more than one.
pub(super) fn sole_char_sink(window: Window) -> Option<Window> {
    let mut sinks = Vec::new();
    let mut pending = vec![window];
    let mut visited = 0;
    while let Some(parent) = pending.pop() {
        let mut child = next_child(parent, None);
        while let Some(current) = child {
            visited += 1;
            if visited > MAX_WINDOWS {
                return None;
            }
            if is_char_sink(current) {
                sinks.push(current);
            } else {
                pending.push(current);
            }
            child = next_child(parent, Some(current));
        }
    }
    match sinks.as_slice() {
        [sink] => Some(*sink),
        _ => None,
    }
}

fn next_child(parent: Window, after: Option<Window>) -> Option<Window> {
    let after = after.map_or(std::ptr::null_mut(), Window::hwnd);
    // SAFETY: [FFI] both HWNDs are opaque values Win32 validates; null class
    // and title match every child.
    Window::from_hwnd(unsafe { FindWindowExW(parent.hwnd(), after, std::ptr::null(), std::ptr::null()) })
}

fn is_char_sink(window: Window) -> bool {
    // SAFETY: [FFI] the HWND is opaque; a stale one reads as hidden/disabled.
    let usable = unsafe { IsWindowVisible(window.hwnd()) != 0 && IsWindowEnabled(window.hwnd()) != 0 };
    if !usable {
        return false;
    }
    let mut code = 0usize;
    // SAFETY: [FFI] WM_GETDLGCODE carries no pointers (lParam 0 is "no
    // message"); `code` is a valid out slot; a hung window times out.
    let answered = unsafe {
        SendMessageTimeoutW(
            window.hwnd(),
            WM_GETDLGCODE,
            0,
            0,
            SMTO_ABORTIFHUNG,
            DLGCODE_TIMEOUT_MS,
            &raw mut code,
        )
    } != 0;
    answered && u32::try_from(code).is_ok_and(|code| code & DLGC_WANTCHARS != 0)
}
