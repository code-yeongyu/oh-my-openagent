//! Where an application sends keystrokes, as accessibility reports it: its
//! focused window, the window holding its focused element, and the windows
//! that could be key (ported from oh-my-pi 18.13.1 `macos/ax.rs` `KeyFocus`,
//! `focused_window`, `window_records`, `reports_active`).

use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::{CFRetained, Type};

use super::element::{copy_attribute_result, copy_bool, copy_element, copy_elements, create_application, window_id};

/// How many `AXParent` hops the focused element's window lookup follows.
const MAX_ANCESTRY_DEPTH: usize = 64;
/// The longest one focus read may block.
const PROBE_TIMEOUT_SECONDS: f32 = 2.0;

/// An application's `AXFocusedWindow`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum FocusedWindow {
    /// The application reports none.
    #[default]
    Unreported,
    /// `_AXUIElementGetWindow` cannot map the window it reports.
    Unmapped,
    /// The read failed, such as an application that did not answer in time.
    Unreadable,
    Id(u32),
}

/// Where an application sends keystrokes: its focused window, and the window
/// holding `AXFocusedUIElement` (the first id mapped on the element or its
/// nearest ancestor, so a field in a sheet maps to the sheet).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct KeyFocus {
    pub(crate) window: FocusedWindow,
    pub(crate) element_window: Option<u32>,
}

/// Where keystrokes posted for one window would go now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum KeyDestination {
    Target,
    /// Into another window the application reports as focused; `None` when
    /// it cannot be mapped to an id.
    Other(Option<u32>),
    /// The application reports no focused window, and its focused element is
    /// not in the target or in a window attached to it.
    Unreported,
}

impl KeyFocus {
    /// Where keystrokes for window `wid` would go. The focused window decides
    /// when the application reports one; a sheet or panel it reports is
    /// another window, even when attached to `wid`, except that a reported
    /// parent of `wid` holding the focused element in `wid` (a popover field)
    /// reaches `wid`. With none reported, as Finder during an inline rename,
    /// the focused element's window decides: `wid`, or one `parent_of` says
    /// is attached to it.
    pub(crate) fn destination(&self, wid: u32, parent_of: impl Fn(u32) -> Option<u32>) -> KeyDestination {
        match self.window {
            FocusedWindow::Id(id) if id == wid => KeyDestination::Target,
            FocusedWindow::Id(_) if self.holds_overlay_focus(wid, &parent_of) => KeyDestination::Target,
            FocusedWindow::Id(id) => KeyDestination::Other(Some(id)),
            FocusedWindow::Unmapped | FocusedWindow::Unreadable => KeyDestination::Other(None),
            FocusedWindow::Unreported => match self.element_window {
                Some(id) if [Some(id), parent_of(id)].contains(&Some(wid)) => KeyDestination::Target,
                _ => KeyDestination::Unreported,
            },
        }
    }

    /// Whether `wid` is an overlay attached to the reported focused window
    /// and the focused element is in it.
    fn holds_overlay_focus(&self, wid: u32, parent_of: impl Fn(u32) -> Option<u32>) -> bool {
        let FocusedWindow::Id(focused) = self.window else {
            return false;
        };
        focused != wid && self.element_window == Some(wid) && parent_of(wid) == Some(focused)
    }

    /// Whether keyboard focus sits in an overlay window such as Finder's
    /// inline rename field or a popover: one attached to `wid` while `wid`,
    /// or nothing, is reported focused; or `wid` itself while it is attached
    /// to the reported window, or nothing is reported. Making `wid` key with
    /// a press would end that overlay's editing.
    pub(crate) fn in_overlay_of(&self, wid: u32, parent_of: impl Fn(u32) -> Option<u32>) -> bool {
        if self.holds_overlay_focus(wid, &parent_of) {
            return true;
        }
        if self.window == FocusedWindow::Unreported && self.element_window == Some(wid) {
            return parent_of(wid).is_some();
        }
        let reported = match self.window {
            FocusedWindow::Unreported => true,
            FocusedWindow::Id(id) => id == wid,
            FocusedWindow::Unmapped | FocusedWindow::Unreadable => false,
        };
        let overlay = self.element_window.filter(|&id| id != wid);
        reported && overlay.is_some_and(|id| parent_of(id) == Some(wid))
    }
}

/// An `AXFocusedWindow` `read`, its element mapped through `id_of`. Only an
/// answer that there is no value says there is no focused window; any other
/// failure leaves it unknown.
pub(crate) fn focused_window<E>(
    read: Result<Option<E>, AXError>,
    id_of: impl FnOnce(&E) -> Option<u32>,
) -> FocusedWindow {
    match read {
        Ok(Some(window)) => id_of(&window).map_or(FocusedWindow::Unmapped, FocusedWindow::Id),
        Ok(None) | Err(AXError::NoValue | AXError::AttributeUnsupported) => FocusedWindow::Unreported,
        Err(_) => FocusedWindow::Unreadable,
    }
}

pub(crate) fn key_focus(pid: libc::pid_t) -> KeyFocus {
    let Some(app) = probe_application(pid) else {
        return KeyFocus {
            window: FocusedWindow::Unreadable,
            element_window: None,
        };
    };
    let read = copy_attribute_result(&app, "AXFocusedWindow")
        .map(|window| window.and_then(|window| window.downcast::<AXUIElement>().ok()));
    let window = focused_window(read, |window| mapped_id(window));
    let element_window = copy_element(&app, "AXFocusedUIElement").and_then(|element| innermost_window_id(&element));
    KeyFocus { window, element_window }
}

/// The first window id mapped on `element` or, through `AXParent`, its
/// nearest ancestor.
fn innermost_window_id(element: &AXUIElement) -> Option<u32> {
    let mut current: CFRetained<AXUIElement> = element.retain();
    for _ in 0..MAX_ANCESTRY_DEPTH {
        if let Some(id) = mapped_id(&current) {
            return Some(id);
        }
        current = copy_element(&current, "AXParent")?;
    }
    None
}

/// One of an application's `AXWindows`: its window id when it maps to one,
/// and whether it is minimized.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct AxWindowRecord {
    pub(crate) id: Option<u32>,
    pub(crate) minimized: Option<bool>,
}

/// The application's `AXWindows`, which unlike `WindowServer`'s list omit the
/// compositor surfaces Chromium, Electron and `WebKit` add per window. An
/// entry that maps to no id is kept: it could still be key. `None` when
/// nothing can be read, so nothing is proven about the windows.
pub(crate) fn window_records(pid: libc::pid_t) -> Option<Vec<AxWindowRecord>> {
    let app = probe_application(pid)?;
    let windows = copy_elements(&app, "AXWindows")?;
    Some(
        windows
            .iter()
            .map(|window| AxWindowRecord {
                id: mapped_id(window),
                minimized: copy_bool(window, "AXMinimized"),
            })
            .collect(),
    )
}

pub(crate) fn focused_window_id(pid: libc::pid_t) -> Option<u32> {
    let app = probe_application(pid)?;
    let window = copy_element(&app, "AXFocusedWindow")?;
    mapped_id(&window)
}

/// `AXFrontmost` as `pid`'s application reports it: `AppKit` answers from the
/// application's own active state, which an `AppKit`-defined activation event
/// sets while `WindowServer`'s front process stays the user's app.
pub(crate) fn reports_active(pid: libc::pid_t) -> Option<bool> {
    let app = probe_application(pid)?;
    copy_bool(&app, "AXFrontmost")
}

fn mapped_id(element: &AXUIElement) -> Option<u32> {
    window_id(element).filter(|&id| id != 0)
}

fn probe_application(pid: libc::pid_t) -> Option<CFRetained<AXUIElement>> {
    let app = create_application(pid).ok()?;
    // SAFETY: The retained application element is valid for the timeout update.
    let _ = unsafe { app.set_messaging_timeout(PROBE_TIMEOUT_SECONDS) };
    Some(app)
}

#[cfg(test)]
#[path = "key_focus_tests.rs"]
mod tests;
