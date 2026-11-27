//! Row 49: the toolkit of a window's client, read from evidence - the libraries its process maps
//! (`/proc/<pid>/maps`) and its helper children - never from a `WM_CLASS` substring, which any
//! client can choose. The toolkit decides the background route (d-linux.md 'XSendEvent background
//! rules and the refusal list'): a Qt client on xcb drops synthetic events unless the shim is
//! loaded, so it is refused `BackgroundUnavailable{toolkit:"qt_xcb"}` with the next call.

/// A client toolkit as the evidence shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Toolkit {
    Gtk3,
    Gtk4,
    QtXcb,
    Chromium,
    Electron,
    Xt,
    Xterm,
    Unknown,
}

/// What the backend read about one window's client.
#[derive(Debug, Clone, Default)]
pub struct Evidence {
    pub wm_class: String,
    /// Paths of the shared objects the process maps.
    pub maps: Vec<String>,
    /// argv[0] of the process's children (Chromium's `--type=` helpers).
    pub children: Vec<String>,
}

/// The toolkit the evidence names.
#[must_use]
pub fn classify(evidence: &Evidence) -> Toolkit {
    let maps = |needle: &str| evidence.maps.iter().any(|path| library(path).contains(needle));
    let helpers = evidence.children.iter().any(|argv| argv.contains(" --type="));
    if helpers {
        let node = maps(".asar") || maps("libnode") || maps("electron");
        return if node { Toolkit::Electron } else { Toolkit::Chromium };
    }
    if maps("libqxcb") && (maps("libqt5gui") || maps("libqt6gui")) {
        Toolkit::QtXcb
    } else if maps("libgtk-4") {
        Toolkit::Gtk4
    } else if maps("libgtk-3") {
        Toolkit::Gtk3
    } else if maps("libxt.") || maps("libxm.") {
        Toolkit::Xt
    } else {
        Toolkit::Unknown
    }
}

/// The lowercased file name of a mapped object's path.
fn library(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase()
}

/// A background route the toolkit cannot take, as the refusal names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackgroundRefusal {
    pub toolkit: &'static str,
    pub reason: &'static str,
    pub next_call: &'static str,
}

/// Whether background input may go to a client of `toolkit`; `qt_shim` says the xcb shim that
/// accepts synthetic events is loaded in it.
///
/// # Errors
/// [`BackgroundRefusal`] naming the toolkit when its client drops synthetic events.
pub fn background_route(toolkit: Toolkit, qt_shim: bool) -> Result<(), BackgroundRefusal> {
    if toolkit == Toolkit::QtXcb && !qt_shim {
        return Err(BackgroundRefusal {
            toolkit: "qt_xcb",
            reason: "toolkit",
            next_call: "raise",
        });
    }
    Ok(())
}

#[cfg(test)]
#[path = "toolkit_tests.rs"]
mod tests;
