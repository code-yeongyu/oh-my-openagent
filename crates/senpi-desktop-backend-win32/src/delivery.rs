//! Pure Win32 background-delivery compatibility matrix (port of oh-my-pi
//! `win32/delivery.rs`).
//!
//! This module deliberately has no Windows imports so its class-name logic is
//! exercised by the host test suite on every platform. `PostMessageW` into a
//! window whose toolkit ignores posted input succeeds at the Win32 level and
//! then does nothing; the matrix turns that silent drop into an explicit
//! `BackgroundUnavailable`.

use senpi_desktop_core::error::DesktopError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventKind {
    MouseClick,
    MouseMove,
    MouseScroll,
    Keystroke,
    KeyCombo,
    TextInput,
}

impl EventKind {
    pub const fn name(self) -> &'static str {
        match self {
            Self::MouseClick => "mouse_click",
            Self::MouseMove => "mouse_move",
            Self::MouseScroll => "mouse_scroll",
            Self::Keystroke => "keystroke",
            Self::KeyCombo => "key_combo",
            Self::TextInput => "text_input",
        }
    }
}

pub fn is_chromium_class(class: &str) -> bool {
    class
        .strip_prefix("Chrome_WidgetWin_")
        .is_some_and(|suffix| !suffix.is_empty())
}

pub fn is_winui3_class(class: &str) -> bool {
    class == "WinUIDesktopWin32WindowClass"
}

pub fn is_wpf_class(class: &str) -> bool {
    class
        .strip_prefix("HwndWrapper[")
        .is_some_and(|body| !body.is_empty() && body.ends_with(']'))
}

pub fn is_tk_class(class: &str) -> bool {
    class == "TkTopLevel"
        || class
            .strip_prefix("TkTopLevel.")
            .is_some_and(|suffix| !suffix.is_empty())
}

pub fn is_gtk_class(class: &str) -> bool {
    class == "gdkWindowToplevel" || class == "gdkSurfaceToplevel"
}

pub fn is_vcl_class(class: &str) -> bool {
    class.strip_prefix("SAL").is_some_and(|suffix| !suffix.is_empty())
}

/// Returns the empirical reason that a posted event would be accepted by
/// Win32 but silently ignored by the target toolkit.
pub fn would_be_silently_dropped(class: &str, kind: EventKind) -> Option<&'static str> {
    use EventKind::{KeyCombo, Keystroke, MouseClick, MouseMove, MouseScroll, TextInput};

    if is_chromium_class(class) {
        return Some("Chromium requires input originating from the system input queue");
    }
    if is_winui3_class(class) && matches!(kind, MouseClick | MouseMove | MouseScroll) {
        return Some("WinUI3 hosts pointer input in a content island rather than the frame HWND");
    }
    if is_wpf_class(class) && matches!(kind, MouseClick | MouseMove | Keystroke | KeyCombo | TextInput) {
        return Some("WPF ignores posted routed pointer and keyboard input");
    }
    if is_tk_class(class) && matches!(kind, Keystroke | KeyCombo | TextInput) {
        return Some("Tk widgets ignore posted keyboard input");
    }
    if is_gtk_class(class) && matches!(kind, MouseClick) {
        return Some("GTK buttons ignore posted mouse-button messages");
    }
    if is_vcl_class(class) && matches!(kind, Keystroke | KeyCombo) {
        return Some("VCL accelerators require real key state from the system input queue");
    }
    None
}

/// The `BackgroundUnavailable` refusal for posting `kind` into window `id`
/// of toolkit class `class`, naming the class and the reason; `None` when the
/// matrix lets the event through.
pub fn background_refusal(id: &str, class: &str, kind: EventKind) -> Option<DesktopError> {
    would_be_silently_dropped(class, kind).map(|reason| {
        DesktopError::background_unavailable(format!(
            "window {id} ({class}) drops background {} events: {reason}; retry with \
             delivery:\"foreground\" or use ax actions",
            kind.name()
        ))
    })
}

/// Refuses input to window `id` when its process runs above the engine's
/// integrity level (`DesktopWindow.elevated == Some(true)`): UIPI drops such
/// input without an error, so it is refused instead of silently lost.
/// UIAccess is out of scope.
///
/// # Errors
/// `PermissionDenied` for an elevated window.
pub fn uipi_check(id: &str, elevated: Option<bool>) -> Result<(), DesktopError> {
    match elevated {
        Some(true) => Err(DesktopError::permission_denied(format!(
            "window {id}: elevated window (UIPI); run senpi elevated or use ax"
        ))),
        Some(false) | None => Ok(()),
    }
}

#[cfg(test)]
mod tests;
