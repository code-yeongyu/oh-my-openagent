//! Thin Win32 wrappers the input routes share: window-id parsing and
//! validation, toolkit class, the UIPI check, layout lookup of a character,
//! the foreground window, and the cursor.

use std::ffi::c_void;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use windows_sys::Win32::Foundation::{HWND, POINT};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MapVirtualKeyW, VkKeyScanW, MAPVK_VK_TO_VSC};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetCursorPos, GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, IsChild,
    IsWindow, SetCursorPos, SetForegroundWindow, GUITHREADINFO,
};

use super::char_sink;
use super::keys::Stroke;
use crate::delivery;
use crate::integrity::{process_elevated, IntegrityRid};

/// A validated top-level window. The HWND is an opaque value, never
/// dereferenced; it is kept as an address so the input state stays `Send`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Window(pub(super) usize);

impl Window {
    /// Parses a `windows()` id (the HWND value) and checks it names a live
    /// window.
    ///
    /// # Errors
    /// `InvalidTarget` for a malformed id, `WindowNotFound` for a stale one.
    pub(super) fn parse(id: &str) -> CoreResult<Self> {
        let address = id
            .parse::<usize>()
            .map_err(|_| DesktopError::invalid_target(format!("invalid Win32 window id '{id}'")))?;
        let window = Self(address);
        if !window.is_live() {
            return Err(DesktopError::window_not_found(format!(
                "target window '{id}' is no longer present"
            )));
        }
        Ok(window)
    }

    /// Parses `id` and refuses a window of a process above the engine's
    /// integrity level: UIPI would drop the input without an error.
    ///
    /// # Errors
    /// As [`Self::parse`], plus `PermissionDenied` for an elevated window.
    pub(super) fn target(id: &str, own: IntegrityRid) -> CoreResult<Self> {
        let window = Self::parse(id)?;
        let elevated = window.process_id().and_then(|pid| process_elevated(pid, own));
        delivery::uipi_check(id, elevated)?;
        Ok(window)
    }

    pub(super) const fn address(self) -> usize {
        self.0
    }

    pub(super) fn hwnd(self) -> HWND {
        std::ptr::without_provenance_mut::<c_void>(self.0)
    }

    pub(super) fn from_hwnd(hwnd: HWND) -> Option<Self> {
        (!hwnd.is_null()).then(|| Self(hwnd.addr()))
    }

    pub(super) fn is_live(self) -> bool {
        // SAFETY: [FFI] `IsWindow` accepts any value and only reports whether
        // it names a live window.
        unsafe { IsWindow(self.hwnd()) != 0 }
    }

    /// The window's class name; `<unknown>` when Win32 cannot read it.
    pub(super) fn class_name(self) -> String {
        let mut buffer = [0u16; 256];
        let capacity = i32::try_from(buffer.len()).unwrap_or(i32::MAX);
        // SAFETY: [Out-of-bounds] `buffer` is writable for `capacity` UTF-16
        // units, the count Win32 is told it may write.
        let length = unsafe { GetClassNameW(self.hwnd(), buffer.as_mut_ptr(), capacity) };
        match usize::try_from(length) {
            Ok(length) if length > 0 => String::from_utf16_lossy(&buffer[..length.min(buffer.len())]),
            Ok(_) | Err(_) => "<unknown>".to_owned(),
        }
    }

    /// The window that receives this window's posted keyboard input (a
    /// top-level frame such as Notepad's drops `WM_CHAR` posted to the frame
    /// itself): its thread's focus window when that is this window or a
    /// descendant of it; else - Win32 clears the focus window of a thread it
    /// deactivates, so a background window has none - its sole descendant
    /// that processes `WM_CHAR` ([`char_sink::sole_char_sink`]); else this
    /// window.
    pub(super) fn keyboard_focus(self) -> Self {
        self.focus_descendant()
            .or_else(|| char_sink::sole_char_sink(self))
            .unwrap_or(self)
    }

    /// The thread's focus window when it is this window or a descendant.
    fn focus_descendant(self) -> Option<Self> {
        // SAFETY: [FFI] the HWND is opaque; a stale one yields thread id 0.
        let thread = unsafe { GetWindowThreadProcessId(self.hwnd(), std::ptr::null_mut()) };
        if thread == 0 {
            return None;
        }
        let size = u32::try_from(std::mem::size_of::<GUITHREADINFO>()).unwrap_or(u32::MAX);
        // SAFETY: [Uninit] GUITHREADINFO is plain integers and HWNDs, for which
        // all-zero is a valid value; `cbSize` is set before the call reads it.
        let mut info: GUITHREADINFO = unsafe { std::mem::zeroed() };
        info.cbSize = size;
        // SAFETY: [FFI] `info` is a writable GUITHREADINFO whose `cbSize`
        // matches its size; a thread without a GUI queue fails and writes nothing.
        if unsafe { GetGUIThreadInfo(thread, &raw mut info) } == 0 {
            return None;
        }
        let focus = Self::from_hwnd(info.hwndFocus)?;
        // SAFETY: [FFI] both HWNDs are opaque values; `IsChild` only reports
        // whether the second descends from the first.
        (focus == self || unsafe { IsChild(self.hwnd(), focus.hwnd()) } != 0).then_some(focus)
    }

    pub(super) fn process_id(self) -> Option<u32> {
        let mut pid = 0;
        // SAFETY: [FFI] the HWND is opaque to Rust; a stale one makes the call
        // return 0 and leave `pid` 0.
        unsafe { GetWindowThreadProcessId(self.hwnd(), &raw mut pid) };
        (pid != 0).then_some(pid)
    }
}

/// The window that owns the foreground, if any.
pub(super) fn foreground() -> Option<Window> {
    // SAFETY: [FFI] no arguments; reads the global foreground state.
    Window::from_hwnd(unsafe { GetForegroundWindow() })
}

/// The foreground window's id (the HWND value) and owning process.
pub(crate) fn foreground_window_id() -> Option<(String, Option<u32>)> {
    foreground().map(|window| (window.address().to_string(), window.process_id()))
}

/// Asks Win32 to give `window` the foreground; `false` when it refused.
pub(super) fn set_foreground(window: Window) -> bool {
    // SAFETY: [FFI] the HWND is an opaque value Win32 validates itself.
    unsafe { SetForegroundWindow(window.hwnd()) != 0 }
}

/// How the active keyboard layout types `character`.
///
/// # Errors
/// `InvalidKey` when the character needs two UTF-16 units or is absent from
/// the active layout.
pub(super) fn layout_stroke(character: char) -> CoreResult<Stroke> {
    let mut units = [0u16; 2];
    let [unit] = character.encode_utf16(&mut units) else {
        return Err(DesktopError::invalid_key(format!(
            "{character:?} has no Win32 virtual key"
        )));
    };
    // SAFETY: [FFI] a scalar lookup in the active layout.
    Stroke::from_scan(unsafe { VkKeyScanW(*unit) }).ok_or_else(|| {
        DesktopError::invalid_key(format!("{character:?} is absent from the active keyboard layout"))
    })
}

/// The hardware scan code of `vk` on the active layout.
pub(super) fn scan_code(vk: u16) -> u32 {
    // SAFETY: [FFI] a scalar lookup in the active layout.
    unsafe { MapVirtualKeyW(u32::from(vk), MAPVK_VK_TO_VSC) }
}

/// The cursor in physical virtual-desktop pixels.
///
/// # Errors
/// `InputFailed` when Win32 cannot read it (e.g. on the secure desktop).
pub(super) fn cursor() -> CoreResult<(i32, i32)> {
    let mut point = POINT { x: 0, y: 0 };
    // SAFETY: [FFI] `point` is a valid out slot for the call.
    if unsafe { GetCursorPos(&raw mut point) } == 0 {
        return Err(DesktopError::input_failed(format!(
            "GetCursorPos failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    Ok((point.x, point.y))
}

/// Moves the cursor to a physical virtual-desktop point without input.
///
/// # Errors
/// `InputFailed` when Win32 refuses.
pub(super) fn set_cursor(x: i32, y: i32) -> CoreResult<()> {
    // SAFETY: [FFI] plain value arguments.
    if unsafe { SetCursorPos(x, y) } == 0 {
        return Err(DesktopError::input_failed(format!(
            "SetCursorPos failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    Ok(())
}
