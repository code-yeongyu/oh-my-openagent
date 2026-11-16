//! Which toolkits drop `XSendEvent` input and which accept it. GTK 3/4, Qt,
//! LibreOffice's VCL, Chromium and Firefox ignore events with the
//! `send_event` flag set; Xt (Xaw, Motif) and Tk dispatch them. A toolkit is
//! named by a `WM_CLASS` substring or by a shared object its process maps
//! (oh-my-pi `linux/x11/toolkit.rs`).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Toolkit {
    Gtk,
    Qt,
    Vcl,
    Chromium,
    Firefox,
    /// xterm, whose `allowSendEvents` (off by default) no other client can read.
    Xterm,
}

impl Toolkit {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Gtk => "GTK",
            Self::Qt => "Qt",
            Self::Vcl => "LibreOffice VCL",
            Self::Chromium => "Chromium",
            Self::Firefox => "Firefox",
            Self::Xterm => "xterm",
        }
    }
}

/// `WM_CLASS` substrings (lowercased) and the toolkit each names; oh-my-pi's
/// needle list plus Electron.
const CLASS_NEEDLES: [(&str, Toolkit); 8] = [
    ("gtk", Toolkit::Gtk),
    ("gdk", Toolkit::Gtk),
    ("qt", Toolkit::Qt),
    ("chrome", Toolkit::Chromium),
    ("chromium", Toolkit::Chromium),
    ("electron", Toolkit::Chromium),
    ("firefox", Toolkit::Firefox),
    ("mozilla", Toolkit::Firefox),
];

/// Shared-object name prefixes of toolkits that drop sent events.
const DROPPING_LIBRARIES: [(&str, Toolkit); 8] = [
    ("libgtk-3.so", Toolkit::Gtk),
    ("libgtk-4.so", Toolkit::Gtk),
    ("libQt5Gui.so", Toolkit::Qt),
    ("libQt6Gui.so", Toolkit::Qt),
    ("libvcl", Toolkit::Vcl),
    ("libmergedlo.so", Toolkit::Vcl),
    ("libxul.so", Toolkit::Firefox),
    ("libcef.so", Toolkit::Chromium),
];

/// Shared-object name prefixes of toolkits that dispatch sent events.
const ACCEPTING_LIBRARIES: [&str; 4] = ["libXt.so", "libXm.so", "libtk8", "libtk9"];

/// The filtering toolkit a raw `WM_CLASS` value names, if any.
pub fn filtering_toolkit(wm_class: &[u8]) -> Option<Toolkit> {
    let class = String::from_utf8_lossy(wm_class).to_ascii_lowercase();
    CLASS_NEEDLES
        .iter()
        .find(|(needle, _)| class.contains(needle))
        .map(|&(_, toolkit)| toolkit)
}

/// The first mapped library of a filtering toolkit, and that toolkit.
pub fn dropping_library(libraries: &[String]) -> Option<(&str, Toolkit)> {
    libraries.iter().find_map(|library| {
        DROPPING_LIBRARIES
            .iter()
            .find(|(prefix, _)| library.starts_with(prefix))
            .map(|&(_, toolkit)| (library.as_str(), toolkit))
    })
}

/// The first mapped library of a toolkit that dispatches sent events.
pub fn accepting_library(libraries: &[String]) -> Option<&str> {
    libraries
        .iter()
        .find(|library| ACCEPTING_LIBRARIES.iter().any(|prefix| library.starts_with(prefix)))
        .map(String::as_str)
}

/// The `WM_CLASS` parts joined for a message: `instance, class`.
pub fn class_label(wm_class: &[u8]) -> String {
    String::from_utf8_lossy(wm_class)
        .split('\0')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}
