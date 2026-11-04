//! Whether background keystrokes for one window would land in it, decided from
//! what its application reports; no reads or posts happen here (ported from
//! oh-my-pi 18.13.1 `macos/input.rs` `keyboard_conflict`, `key_route`,
//! `key_refusal`, `keys_still_reach`, `front_target`, `recheck_background`).
//!
//! macOS posts key events to a process, which hands them to whichever window
//! it treats as key; they carry no window id. Keys therefore go out only once
//! the application reports keyboard focus in the target, or reports no focused
//! window while the target is the only window that could be key, and every
//! press is checked against that proof again.

use senpi_desktop_core::error::{CoreResult, DesktopError};

use crate::ax::key_focus::{AxWindowRecord, FocusedWindow, KeyDestination, KeyFocus};

/// Most windows deep a chain of sheets attached to sheets is followed.
const MAX_ATTACHED_DEPTH: usize = 4;

/// Why keys posted to the process could reach a window other than the target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum KeyboardConflict {
    /// The target is not among the process's accessibility windows, not its
    /// focused window, and not attached to one of them: nothing about its key
    /// status can be proven.
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
    // A minimized window cannot be key; an unreadable state, or an entry with
    // no id (Finder's desktop), could be.
    let siblings = records
        .iter()
        .filter(|record| record.id != Some(wid) && record.minimized != Some(true))
        .count();
    (siblings > 0).then_some(KeyboardConflict::Siblings(siblings))
}

/// What background keyboard delivery does with where keys would go now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum KeyVerdict {
    Deliver,
    /// Not proven yet; read again until the deadline.
    Wait,
}

/// Keys go out once they would reach the target. When the application reports
/// no focused window at all, the target being its only possible key window is
/// the remaining proof; another reported focused window never is.
pub(super) const fn key_verdict(destination: KeyDestination, conflict: Option<KeyboardConflict>) -> KeyVerdict {
    match (destination, conflict) {
        (KeyDestination::Target, _) | (KeyDestination::Unreported, None) => KeyVerdict::Deliver,
        _ => KeyVerdict::Wait,
    }
}

/// Whether `window` is attached, directly or through other attached windows,
/// to a window `is_ancestor` accepts, as `parent_of` reports parents.
pub(super) fn attached_under(
    window: u32,
    parent_of: impl Fn(u32) -> Option<u32>,
    is_ancestor: impl Fn(u32) -> bool,
) -> bool {
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

pub(super) fn unmapped_keyboard_refusal(wid: u32) -> DesktopError {
    DesktopError::background_unavailable(format!(
        "window {wid} is not among its application's accessibility windows, is not its focused \
         window, and is not attached to one of its windows, so background keystrokes cannot be \
         proven to reach it; nothing was sent",
    ))
}

/// The error for keys that never would have reached `wid`; nothing was sent.
/// A window with a sheet or panel attached and focused cannot become key in
/// the background or in takeover, so that case names the attached window.
pub(super) fn key_refusal(
    wid: u32,
    destination: KeyDestination,
    conflict: Option<KeyboardConflict>,
    parent_of: impl Fn(u32) -> Option<u32>,
) -> DesktopError {
    match destination {
        KeyDestination::Other(Some(other)) if attached_under(other, parent_of, |parent| parent == wid) => {
            DesktopError::invalid_target(format!(
                "window {wid} has window {other} (a sheet, panel or popover) attached and focused, \
                 which takes every keystroke sent to its application, so window {wid} cannot receive \
                 keys in the background or in takeover; nothing was sent; send them to window \
                 {other}, or close it first",
            ))
        }
        KeyDestination::Other(other) => {
            let focused = other.map_or_else(
                || "a window it does not identify, or did not answer about,".to_owned(),
                |id| format!("window {id}"),
            );
            DesktopError::background_unavailable(format!(
                "window {wid} did not become its application's key window, and {focused} still is, so \
                 background keystrokes would reach that window; nothing was sent",
            ))
        }
        KeyDestination::Target | KeyDestination::Unreported => {
            let siblings = match conflict {
                Some(KeyboardConflict::Siblings(siblings)) => siblings,
                _ => 0,
            };
            DesktopError::background_unavailable(format!(
                "window {wid} shares its application with {siblings} other window(s) and did not \
                 become its key window, so background keystrokes could reach another window; nothing \
                 was sent",
            ))
        }
    }
}

/// Before a background press: keys posted now still reach `wid` as `proven`,
/// the focus that admitted delivery, showed. Focus read `now` must pass the
/// same [`key_verdict`]; once the user or the application makes another
/// window key the press would land there. With no focused window reported,
/// the windows are read again (`conflict`): one opened since could take the
/// keys. When the focused element decided (Finder's rename field), it must
/// still be in the window it was in.
pub(super) fn keys_still_reach(
    wid: u32,
    conflict: impl FnOnce() -> Option<KeyboardConflict>,
    proven: KeyFocus,
    now: KeyFocus,
    parent_of: impl Fn(u32) -> Option<u32>,
) -> CoreResult<()> {
    let element_decided = proven.window != FocusedWindow::Id(wid) && proven.element_window.is_some();
    let destination = now.destination(wid, parent_of);
    let conflict = if destination == KeyDestination::Unreported {
        conflict()
    } else {
        None
    };
    let routed = key_verdict(destination, conflict) == KeyVerdict::Deliver;
    if routed && (!element_decided || now.element_window == proven.element_window) {
        return Ok(());
    }
    Err(DesktopError::input_failed(format!(
        "keyboard focus left window {wid}, or the overlay it was in, during background input; keys \
         sent before that may already have landed, and nothing more was sent; inspect the window \
         before retrying",
    )))
}

#[cfg(test)]
#[path = "key_route_tests.rs"]
mod tests;
