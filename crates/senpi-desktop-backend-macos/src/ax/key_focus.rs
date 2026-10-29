//! Where an application sends keystrokes: its `AXFocusedWindow` and the
//! window holding its `AXFocusedUIElement`, and what that means for keys
//! posted to the process for one window (ported from oh-my-pi 0838d2ab44
//! `KeyFocus`, `KeyDestination`, `window_records`, `content_owner`).

use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::{CFRetained, Type};

use super::element::{copy_attribute_result, copy_bool, copy_element, copy_elements, create_application, set_timeout, window_id};

/// How many `AXParent` hops the window ascent follows before giving up.
const MAX_ANCESTRY_DEPTH: usize = 40;

/// One of an application's `AXWindows`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct AxWindowRecord {
    /// The WindowServer id, when the private SPI maps it (Finder's desktop
    /// entry maps to none).
    pub(crate) id: Option<u32>,
    pub(crate) minimized: Option<bool>,
}

/// An application's `AXFocusedWindow`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum FocusedWindow {
    /// The application reports none.
    #[default]
    Unreported,
    /// The SPI cannot map the window it reports.
    Unmapped,
    /// The read failed, such as an application that did not answer in time,
    /// so nothing is known about its focused window.
    Unreadable,
    Id(u32),
}

/// Where an application sends keystrokes: its focused window and the element
/// holding keyboard focus.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct KeyFocus {
    pub(crate) window: FocusedWindow,
    /// The window holding `AXFocusedUIElement`: the first id the SPI maps on
    /// the element or its nearest ancestor, so a field in a sheet maps to the
    /// sheet, not to the window it is attached to.
    pub(crate) element_window: Option<u32>,
    /// Whether that id is the focused element's own, not an ancestor's. The
    /// fields of an Open panel's Go to Folder sheet map to no window: another
    /// process draws them.
    pub(crate) element_mapped: bool,
}

/// Where keystrokes posted for window `wid` would go now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum KeyDestination {
    /// Into `wid`, posted to this process.
    Target(libc::pid_t),
    /// Into another window the application reports as focused; `None` when
    /// that window cannot be mapped to an id.
    Other(Option<u32>),
    /// The application reports no focused window, and its focused element is
    /// not in `wid` or in a window attached to it.
    Unreported,
}

impl KeyFocus {
    /// Where keystrokes for window `wid` of process `pid` would go.
    ///
    /// The focused window decides when the application reports one; a sheet
    /// or panel it reports is another window, even when attached to `wid`.
    /// When it reports `wid`'s parent while the focused element is in `wid`,
    /// as Reminders does for a field in its details popover, keys reach `wid`.
    /// When it reports none, as Finder does while its inline rename field (an
    /// overlay window of its own) has focus, the focused element's window
    /// decides: `wid` itself, or a window `parent_of` says is attached to it.
    pub(crate) fn destination(&self, pid: libc::pid_t, wid: u32, parent_of: impl Fn(u32) -> Option<u32>) -> KeyDestination {
        match self.window {
            FocusedWindow::Id(id) if id == wid => KeyDestination::Target(pid),
            FocusedWindow::Id(_) if self.holds_overlay_focus(wid, &parent_of) => KeyDestination::Target(pid),
            FocusedWindow::Id(id) => KeyDestination::Other(Some(id)),
            FocusedWindow::Unmapped | FocusedWindow::Unreadable => KeyDestination::Other(None),
            FocusedWindow::Unreported => match self.element_window {
                Some(id) if [Some(id), parent_of(id)].contains(&Some(wid)) => KeyDestination::Target(pid),
                _ => KeyDestination::Unreported,
            },
        }
    }

    /// Whether `wid` is an overlay attached to the reported focused window
    /// and the focused element is in it, such as a field in a popover.
    fn holds_overlay_focus(&self, wid: u32, parent_of: impl Fn(u32) -> Option<u32>) -> bool {
        let FocusedWindow::Id(focused) = self.window else {
            return false;
        };
        focused != wid && self.element_window == Some(wid) && parent_of(wid) == Some(focused)
    }

    /// Whether the focused element itself maps to window `wid`, which proves
    /// that `wid`'s own process holds the focus there.
    pub(crate) fn element_maps_to(&self, wid: u32) -> bool {
        self.element_mapped && self.element_window == Some(wid)
    }
}

/// Reads where `pid` sends keystrokes; every part it cannot read is `None`,
/// and a focused window that cannot be read is [`FocusedWindow::Unreadable`].
pub(crate) fn key_focus(pid: libc::pid_t) -> KeyFocus {
    let Some(app) = probe_application(pid) else {
        return KeyFocus {
            window: FocusedWindow::Unreadable,
            ..KeyFocus::default()
        };
    };
    let window = focused_window(
        copy_attribute_result(&app, "AXFocusedWindow")
            .map(|window| window.and_then(|window| window.downcast::<AXUIElement>().ok())),
        |window| window_id(window),
    );
    let element = copy_element(&app, "AXFocusedUIElement");
    let (element_window, element_mapped) = element
        .as_deref()
        .and_then(innermost_window_id)
        .map_or((None, false), |(id, own)| (Some(id), own));
    KeyFocus {
        window,
        element_window,
        element_mapped,
    }
}

/// An `AXFocusedWindow` `read`, its element mapped through `id_of`. Only
/// an answer that there is no value says the application has no focused
/// window; any other failure leaves it unknown.
pub(crate) fn focused_window<E>(read: Result<Option<E>, AXError>, id_of: impl FnOnce(&E) -> Option<u32>) -> FocusedWindow {
    match read {
        Ok(Some(window)) => id_of(&window).map_or(FocusedWindow::Unmapped, FocusedWindow::Id),
        Ok(None) | Err(AXError::NoValue | AXError::AttributeUnsupported) => FocusedWindow::Unreported,
        Err(_) => FocusedWindow::Unreadable,
    }
}

/// WindowServer id of `pid`'s `AXFocusedWindow`.
pub(crate) fn focused_window_id(pid: libc::pid_t) -> Option<u32> {
    let app = probe_application(pid)?;
    let window: CFRetained<AXUIElement> = copy_element(&app, "AXFocusedWindow")?;
    window_id(&window)
}

/// `pid`'s `AXWindows` as records; `None` when the application cannot be
/// read.
pub(crate) fn window_records(pid: libc::pid_t) -> Option<Vec<AxWindowRecord>> {
    let app = probe_application(pid)?;
    let windows = copy_elements(&app, "AXWindows")?;
    Some(
        windows
            .iter()
            .map(|window| AxWindowRecord {
                id: window_id(window),
                minimized: copy_bool(window, "AXMinimized"),
            })
            .collect(),
    )
}

/// The first window id the SPI maps on `element` or, through a bounded
/// `AXParent` ascent, its nearest ancestor, and whether it is the element's
/// own.
fn innermost_window_id(element: &AXUIElement) -> Option<(u32, bool)> {
    let mut current: CFRetained<AXUIElement> = element.retain();
    for depth in 0..MAX_ANCESTRY_DEPTH {
        if let Some(id) = window_id(&current) {
            return Some((id, depth == 0));
        }
        current = copy_element(&current, "AXParent")?;
    }
    None
}

/// The application element of `pid` with the short probe timeout.
fn probe_application(pid: libc::pid_t) -> Option<CFRetained<AXUIElement>> {
    let app = create_application(pid).ok()?;
    let _ = set_timeout(&app);
    Some(app)
}

/// Which process draws a window's content.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WindowContent {
    /// The window's own process, or nothing shows another one.
    Own,
    /// Another process: the window is a remote view of `window`, a window of
    /// process `pid` that WindowServer keeps off its window list. System Open
    /// and Save panels, and the sheets they open, are drawn this way by
    /// `openAndSavePanelService`.
    Remote { pid: libc::pid_t, window: u32 },
}

/// Who draws window `wid` of process `pid`, read from its accessibility
/// window whether or not it is the focused one, so that a system panel
/// behind another window of its application still shows its drawing process;
/// [`WindowContent::Own`] when that window cannot be found or read. A sheet
/// or popover, which `AXWindows` omits, is found attached to a listed window.
pub(crate) fn window_content(pid: libc::pid_t, wid: u32) -> WindowContent {
    let Some(app) = probe_application(pid) else {
        return WindowContent::Own;
    };
    let focused = copy_element(&app, "AXFocusedWindow");
    let Some(window) = target_window(wid, focused, |focused| window_id(focused), || find_window(&app, wid)) else {
        return WindowContent::Own;
    };
    let children = copy_elements(&window, "AXChildren").unwrap_or_default();
    content_owner(pid, wid, children.iter().map(|child| window_id(child)), crate::skylight::window_owner_pid)
}

/// Window `wid`'s accessibility element: the application's `focused` window
/// when that is `wid`, which spares the search through its windows and
/// sheets, else what `find` finds (oh-my-pi 0838d2ab44 `target_window`).
pub(crate) fn target_window<E>(
    wid: u32,
    focused: Option<E>,
    id_of: impl Fn(&E) -> Option<u32>,
    find: impl FnOnce() -> Option<E>,
) -> Option<E> {
    focused.filter(|focused| id_of(focused) == Some(wid)).or_else(find)
}

/// Most windows a search for an attached sheet or popover descends through.
const MAX_ATTACHED_SEARCH_DEPTH: usize = 4;

/// Window `wid` among `app`'s `AXWindows`, or attached to one of them as a
/// sheet or popover (`AXSheets`, `AXPopovers`), which `AXWindows` omits.
fn find_window(app: &AXUIElement, wid: u32) -> Option<CFRetained<AXUIElement>> {
    find_window_in(
        wid,
        copy_elements(app, "AXWindows")?,
        |window| window_id(window),
        |window, attribute| copy_elements(window, attribute),
    )
}

fn find_window_in<E: Clone>(
    wid: u32,
    windows: Vec<E>,
    id_of: impl Fn(&E) -> Option<u32>,
    attachments: impl Fn(&E, &str) -> Option<Vec<E>>,
) -> Option<E> {
    if let Some(window) = windows.iter().find(|window| id_of(window) == Some(wid)) {
        return Some(window.clone());
    }
    let mut level = windows;
    for _ in 0..MAX_ATTACHED_SEARCH_DEPTH {
        let mut next = Vec::new();
        for window in &level {
            for attribute in ["AXSheets", "AXPopovers"] {
                for attached in attachments(window, attribute).unwrap_or_default() {
                    if id_of(&attached) == Some(wid) {
                        return Some(attached);
                    }
                    next.push(attached);
                }
            }
        }
        if next.is_empty() {
            return None;
        }
        level = next;
    }
    None
}

/// [`window_content`]'s decision from the window ids the window's children
/// map to (`None` for a child that maps to none) and `owner_of`, which reads
/// a window's WindowServer owner. A remote view's elements report the host's
/// pid, but the SPI maps them to the drawing process's own window. The content
/// counts as remote only while no child maps to a window of `pid`, so a window
/// that embeds a remote view among controls of its own stays the host's.
pub(crate) fn content_owner(
    pid: libc::pid_t,
    wid: u32,
    children: impl IntoIterator<Item = Option<u32>>,
    owner_of: impl Fn(u32) -> Option<libc::pid_t>,
) -> WindowContent {
    let mut remote = None;
    for id in children.into_iter().flatten() {
        if id == wid {
            return WindowContent::Own;
        }
        if matches!(remote, Some(WindowContent::Remote { window, .. }) if window == id) {
            continue;
        }
        match owner_of(id) {
            Some(owner) if owner != pid => {
                remote.get_or_insert(WindowContent::Remote { pid: owner, window: id });
            }
            _ => return WindowContent::Own,
        }
    }
    remote.unwrap_or(WindowContent::Own)
}

#[cfg(test)]
#[path = "key_focus_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "key_window_lookup_tests.rs"]
mod lookup_tests;
