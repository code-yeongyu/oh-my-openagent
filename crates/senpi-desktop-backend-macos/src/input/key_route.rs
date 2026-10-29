//! Background keyboard delivery decisions for one window of a process:
//! whether keys posted to the process can be proven to reach the window,
//! which process takes them, and whether that proof still holds before every
//! press (ported from oh-my-pi 0838d2ab44 `keyboard_conflict`, `key_route`,
//! `keys_still_reach`, `owner_still_focused`, `key_process`, `input_owner`,
//! `attached_under`). Decisions only; nothing here posts events.

use senpi_desktop_core::error::{CoreResult, DesktopError};

use crate::ax::{AxWindowRecord, FocusedWindow, KeyDestination, KeyFocus, WindowContent};

/// Why process-scoped background keystrokes could reach a window other than
/// the target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum KeyboardConflict {
    /// The target is not among the process's accessibility windows, is not
    /// its focused window, and is not attached to one of its windows, so no
    /// claim about its key status can be proven.
    Unmapped,
    /// Other windows of the process could be the key window.
    Siblings(usize),
}

/// `outside_list` tells whether a target missing from `records` still is a
/// window of the process, such as a focused or attached sheet.
pub(super) fn keyboard_conflict(
    wid: u32,
    records: &[AxWindowRecord],
    outside_list: impl FnOnce() -> bool,
) -> Option<KeyboardConflict> {
    if !records.iter().any(|record| record.id == Some(wid)) && !outside_list() {
        return Some(KeyboardConflict::Unmapped);
    }
    // A minimized window cannot be key; an unreadable state could be. An entry
    // with no window id, such as Finder's desktop, could be key too.
    let siblings = records
        .iter()
        .filter(|record| record.id != Some(wid) && record.minimized != Some(true))
        .count();
    (siblings > 0).then_some(KeyboardConflict::Siblings(siblings))
}

/// What background keyboard delivery does with where keys would go now.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum KeyDecision {
    /// Post the keys to this process.
    Deliver(libc::pid_t),
    /// Not yet proven; read again until the deadline.
    Wait,
}

/// Keys go out once they would reach `wid`. When the application reports no
/// focused window at all, the target being its only possible key window is
/// the remaining proof; another reported focused window never is.
pub(super) const fn decide(pid: libc::pid_t, destination: KeyDestination, conflict: Option<KeyboardConflict>) -> KeyDecision {
    match (destination, conflict) {
        (KeyDestination::Target(to), _) => KeyDecision::Deliver(to),
        (KeyDestination::Unreported, None) => KeyDecision::Deliver(pid),
        _ => KeyDecision::Wait,
    }
}

/// The refusal when keys for `wid` could not be proven to reach it in time:
/// a sheet or panel attached to `wid` holds the focus (`InvalidTarget`: the
/// keys belong to that window), another window is focused or the proof is
/// missing (`BackgroundUnavailable`, rerunnable in the foreground). Nothing
/// was sent.
pub(super) fn key_refusal(
    wid: u32,
    destination: KeyDestination,
    conflict: Option<KeyboardConflict>,
    parent_of: impl Fn(u32) -> Option<u32>,
) -> DesktopError {
    match destination {
        KeyDestination::Other(Some(other)) if attached_under(other, &parent_of, |parent| parent == wid) => {
            DesktopError::invalid_target(format!(
                "window {wid} is behind its own sheet or panel, window {other}, which holds its \
                 application's keyboard focus; send them to window {other} instead; nothing was sent"
            ))
        }
        KeyDestination::Other(Some(other)) => DesktopError::background_unavailable(format!(
            "window {other} still is the focused window of window {wid}'s application after it was asked to \
             make window {wid} key, so background keystrokes would land there; retry with \
             delivery:\"foreground\" or use ax actions; nothing was sent"
        )),
        KeyDestination::Other(None) => DesktopError::background_unavailable(format!(
            "window {wid}'s application did not report which window holds its keyboard focus, so \
             background keystrokes cannot be proven to reach it; retry with delivery:\"foreground\" or \
             use ax actions; nothing was sent"
        )),
        KeyDestination::Target(_) | KeyDestination::Unreported => {
            let siblings = match conflict {
                Some(KeyboardConflict::Siblings(count)) => count,
                Some(KeyboardConflict::Unmapped) | None => 0,
            };
            DesktopError::background_unavailable(format!(
                "window {wid}'s application reports no focused window and {siblings} other window(s) of it \
                 could be key, so background keystrokes cannot be proven to reach window {wid}; retry \
                 with delivery:\"foreground\" or use ax actions; nothing was sent"
            ))
        }
    }
}

pub(super) fn unmapped_keyboard_refusal(wid: u32) -> DesktopError {
    DesktopError::background_unavailable(format!(
        "window {wid} is not among its application's accessibility windows, is not its focused \
         window, and is not attached to one of its windows, so background keystrokes cannot be \
         proven to reach it; nothing was sent",
    ))
}

/// Before a background press: keys posted to the process now still reach
/// `wid` as `proven`, the focus that admitted delivery, showed. The focus
/// read now must pass the same [`decide`]; once the user or the application
/// makes another window key, including one opened since, the press would land
/// there. When the application reports no focused window, `wid` being its
/// only possible key window is the proof, so the windows are read again
/// (`conflict`): one it opened or unminimized since could be taking the keys.
/// When the focused element decided, because the application did not report
/// `wid` as its focused window (Finder's rename field, Reminders' popover),
/// the element must still be in the window it was in.
pub(super) fn keys_still_reach(
    pid: libc::pid_t,
    wid: u32,
    conflict: impl FnOnce() -> Option<KeyboardConflict>,
    proven: KeyFocus,
    focus: impl FnOnce() -> KeyFocus,
    parent_of: impl Fn(u32) -> Option<u32>,
) -> CoreResult<()> {
    let now = focus();
    let element_decided = proven.window != FocusedWindow::Id(wid) && proven.element_window.is_some();
    let destination = now.destination(pid, wid, parent_of);
    // Only a destination the application does not report depends on the
    // window set.
    let conflict = if destination == KeyDestination::Unreported {
        conflict()
    } else {
        None
    };
    let routed = matches!(decide(pid, destination, conflict), KeyDecision::Deliver(_));
    if routed && (!element_decided || now.element_window == proven.element_window) {
        return Ok(());
    }
    Err(DesktopError::input_failed(format!(
        "keyboard focus left window {wid}, or the overlay it was in, during background input; keys \
         sent before that may already have landed, and nothing more was sent; inspect the window \
         before retrying",
    )))
}

/// The process to post background keys for window `wid` of `pid` to, and
/// the window of it they go into, once `focus` shows they would reach `wid`:
/// [`input_owner`] of the window's `content`. A focused element that maps to
/// `wid` itself shows the window's own process holds the focus, so the
/// content is read only when it does not.
pub(super) fn key_process(
    pid: libc::pid_t,
    wid: u32,
    focus: &KeyFocus,
    content: impl FnOnce() -> WindowContent,
    focused_window_of: impl FnOnce(libc::pid_t) -> Option<u32>,
) -> CoreResult<(libc::pid_t, u32)> {
    if focus.window != FocusedWindow::Id(wid) || focus.element_maps_to(wid) {
        return Ok((pid, wid));
    }
    input_owner(pid, wid, content(), focused_window_of)
}

/// Before a background press for window `wid` of `pid` that goes to another
/// process drawing it (`owner`, from [`key_process`]): that process must
/// still report focus in its window. It routes the keys to its own key
/// window, so once another of its windows becomes key the press would land
/// there.
pub(super) fn owner_still_focused(
    pid: libc::pid_t,
    wid: u32,
    (owner, window): (libc::pid_t, u32),
    focused_window_of: impl FnOnce(libc::pid_t) -> Option<u32>,
) -> CoreResult<()> {
    // Keys the window's own process takes reach it through the focus checks.
    if owner == pid || focused_window_of(owner) == Some(window) {
        return Ok(());
    }
    Err(DesktopError::input_failed(format!(
        "process {owner}, which draws window {wid}, stopped reporting focus in its window {window} \
         during background input; keys sent before that may already have landed, and nothing more \
         was sent; inspect the window before retrying",
    )))
}

/// The process and window that take background input for window `wid` of
/// `pid`, given who draws it (`content`). A system Open or Save panel is a
/// window of the application that asked for it, but `openAndSavePanelService`
/// draws its content in a window of its own and handles its input: keys
/// posted to the application are dropped without an error. Input for such a
/// window goes to the drawing process once it reports focus there, and
/// refuses while it does not.
pub(super) fn input_owner(
    pid: libc::pid_t,
    wid: u32,
    content: WindowContent,
    focused_window_of: impl FnOnce(libc::pid_t) -> Option<u32>,
) -> CoreResult<(libc::pid_t, u32)> {
    match content {
        WindowContent::Own => Ok((pid, wid)),
        WindowContent::Remote { pid: owner, window } if focused_window_of(owner) == Some(window) => Ok((owner, window)),
        WindowContent::Remote { pid: owner, window } => Err(DesktopError::background_unavailable(format!(
            "window {wid} shows content drawn by process {owner}, such as a system Open or Save panel, \
             and that process does not report focus in its window {window}, so background input would \
             be dropped; nothing was sent",
        ))),
    }
}

/// Most windows deep a chain of sheets attached to sheets is followed.
const MAX_ATTACHED_DEPTH: usize = 4;

/// Whether `window` is attached, directly or through other attached windows,
/// to a window `is_ancestor` accepts, as `parent_of` reports WindowServer's
/// parents.
pub(super) fn attached_under(window: u32, parent_of: impl Fn(u32) -> Option<u32>, is_ancestor: impl Fn(u32) -> bool) -> bool {
    let mut current = window;
    for _ in 0..MAX_ATTACHED_DEPTH {
        match parent_of(current) {
            Some(parent) if is_ancestor(parent) => return true,
            Some(parent) => current = parent,
            None => return false,
        }
    }
    false
}

#[cfg(test)]
#[path = "key_route_tests.rs"]
mod tests;
