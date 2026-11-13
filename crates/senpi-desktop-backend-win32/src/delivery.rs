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

#[derive(Clone, Copy, Debug)]
pub struct TargetTraits<'a> {
    pub class: &'a str,
    pub chromium_descendant: bool,
    pub foreground: bool,
    pub xaml_host: bool,
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
        || class.starts_with("CefBrowser")
        || class == "Chrome_RenderWidgetHostHWND"
}

pub fn is_uwp_frame_class(class: &str) -> bool {
    matches!(class, "ApplicationFrameWindow" | "Windows.UI.Core.CoreWindow")
}

pub fn is_terminal_class(class: &str) -> bool {
    [
        "CASCADIA_HOSTING_WINDOW_CLASS",
        "ConsoleWindowClass",
        "mintty",
        "nvim",
        "Vim",
    ]
    .into_iter()
    .any(|prefix| class.starts_with(prefix))
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
    ["gdkWindow", "gdkSurface"].into_iter().any(|prefix| {
        class
            .strip_prefix(prefix)
            .is_some_and(|suffix| !suffix.is_empty())
    })
}

pub fn is_vcl_class(class: &str) -> bool {
    class.strip_prefix("SAL").is_some_and(|suffix| !suffix.is_empty())
}

/// Returns the empirical reason that a posted event would be accepted by
/// Win32 but silently ignored by the target toolkit.
pub fn would_be_silently_dropped(target: TargetTraits<'_>, kind: EventKind) -> Option<&'static str> {
    use EventKind::{KeyCombo, Keystroke, MouseClick, MouseMove, MouseScroll, TextInput};

    let class = target.class;
    if is_chromium_class(class) {
        return Some("Chromium requires input originating from the system input queue");
    }
    if target.chromium_descendant && matches!(kind, MouseMove | MouseScroll | KeyCombo) {
        return Some(
            "its embedded Chromium renderer takes drags, wheel, and modifier chords only from the system input queue",
        );
    }
    if target.xaml_host && matches!(kind, Keystroke | KeyCombo | TextInput) {
        return Some("XAML hosts read keyboard input only from the system input queue");
    }
    if is_uwp_frame_class(class) && matches!(kind, MouseClick | MouseMove) {
        return Some("UWP content reads pointer input only from the system input queue");
    }
    if is_winui3_class(class) && matches!(kind, MouseClick | MouseMove | MouseScroll) {
        return Some("WinUI3 hosts pointer input in a content island rather than the frame HWND");
    }
    if is_wpf_class(class)
        && (matches!(kind, MouseClick | MouseMove | TextInput)
            || (!target.foreground && matches!(kind, Keystroke | KeyCombo)))
    {
        return Some(
            "WPF ignores posted pointer and text input, and posted keys unless it owns the foreground",
        );
    }
    if is_tk_class(class) && matches!(kind, MouseClick | Keystroke | KeyCombo | TextInput) {
        return Some("Tk reads button and key state from GetKeyState, which posted input never sets");
    }
    if is_gtk_class(class) && matches!(kind, MouseClick) {
        return Some("GTK buttons ignore posted mouse-button messages");
    }
    if is_vcl_class(class) && matches!(kind, Keystroke | KeyCombo) {
        return Some("VCL accelerators require real key state from the system input queue");
    }
    if is_terminal_class(class) && !target.foreground && matches!(kind, TextInput) {
        return Some("terminal hosts read text through their console input channel");
    }
    None
}

pub const fn non_client_drag_region(hit: isize) -> Option<&'static str> {
    match hit {
        2 => Some("caption"),
        4 => Some("size box"),
        10..=17 => Some("resize border"),
        _ => None,
    }
}

pub const fn posts_double_click(index: u32, class_wants_double: bool) -> bool {
    class_wants_double && index % 2 == 1
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextUnit {
    Char(char),
    Enter,
}

pub fn text_units(text: &str) -> impl Iterator<Item = TextUnit> + '_ {
    text_steps(text).map(|(unit, _)| unit)
}

/// Normalized input and the number of source scalars delivered by each step.
pub(crate) fn text_steps(text: &str) -> impl Iterator<Item = (TextUnit, usize)> + '_ {
    let mut characters = text.chars().peekable();
    std::iter::from_fn(move || {
        let character = characters.next()?;
        Some(match character {
            '\r' if characters.next_if_eq(&'\n').is_some() => (TextUnit::Enter, 2),
            '\n' | '\r' => (TextUnit::Enter, 1),
            other => (TextUnit::Char(other), 1),
        })
    })
}

pub fn text_input_unsupported(class: &str, arm64: bool) -> Option<&'static str> {
    (arm64 && class.starts_with("ConsoleWindowClass")).then_some(
        "native console host on Windows ARM64 accepts synthesized text without delivering it; drive the console through a process or PTY instead",
    )
}

/// The `BackgroundUnavailable` refusal for posting `kind` into window `id`
/// of toolkit class `class`, naming the class and the reason; `None` when the
/// matrix lets the event through.
pub fn background_refusal(id: &str, class: &str, kind: EventKind) -> Option<DesktopError> {
    background_refusal_for(
        id,
        TargetTraits {
            class,
            chromium_descendant: false,
            foreground: false,
            xaml_host: false,
        },
        kind,
    )
}

pub fn background_refusal_for(
    id: &str,
    target: TargetTraits<'_>,
    kind: EventKind,
) -> Option<DesktopError> {
    would_be_silently_dropped(target, kind).map(|reason| {
        DesktopError::background_unavailable(format!(
            "window {id} ({class}) drops background {} events: {reason}; retry with \
             delivery:\"foreground\" or use ax actions",
            kind.name(),
            class = target.class,
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
