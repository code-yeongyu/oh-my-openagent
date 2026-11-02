//! Toolkits that drop `XSendEvent` input: GTK, Qt, Chromium and Firefox
//! ignore events with the `send_event` flag set, so background delivery to
//! them would silently do nothing. They are refused with
//! `BackgroundUnavailable` instead (never retried in the foreground).

use senpi_desktop_core::error::DesktopError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Toolkit {
    Gtk,
    Qt,
    Chromium,
    Firefox,
}

impl Toolkit {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Gtk => "GTK",
            Self::Qt => "Qt",
            Self::Chromium => "Chromium",
            Self::Firefox => "Firefox",
        }
    }
}

/// `WM_CLASS` substrings (lowercased) and the toolkit each names; oh-my-pi's
/// needle list.
const NEEDLES: [(&str, Toolkit); 7] = [
    ("gtk", Toolkit::Gtk),
    ("gdk", Toolkit::Gtk),
    ("qt", Toolkit::Qt),
    ("chrome", Toolkit::Chromium),
    ("chromium", Toolkit::Chromium),
    ("firefox", Toolkit::Firefox),
    ("mozilla", Toolkit::Firefox),
];

/// The filtering toolkit a raw `WM_CLASS` value names, if any.
pub fn filtering_toolkit(wm_class: &[u8]) -> Option<Toolkit> {
    let class = String::from_utf8_lossy(wm_class).to_ascii_lowercase();
    NEEDLES
        .iter()
        .find(|(needle, _)| class.contains(needle))
        .map(|&(_, toolkit)| toolkit)
}

/// Why background `kind` input to `window` is refused; names the toolkit and
/// the `WM_CLASS` it was recognised by.
pub fn background_unavailable(window: &str, kind: &str, toolkit: Toolkit, wm_class: &[u8]) -> DesktopError {
    let class = String::from_utf8_lossy(wm_class)
        .split('\0')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    DesktopError::background_unavailable(format!(
        "window {window} drops background {kind} events: {} (WM_CLASS {class}) filters synthetic \
         XSendEvent input; retry with delivery:\"foreground\" or use ax actions",
        toolkit.name()
    ))
}
