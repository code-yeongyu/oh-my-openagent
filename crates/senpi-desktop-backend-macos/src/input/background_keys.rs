//! Background keyboard delivery to one window: proves, before any key, that
//! keys posted to the process would reach the window, finds the process that
//! takes them, and re-proves it before every press (ported from oh-my-pi
//! 0838d2ab44 `with_background_keyboard`). Replaces the sole-window rule:
//! macOS posts key events to a process, which hands them to whichever window
//! it treats as key, so keys go out only once the application reports keyboard
//! focus in the target or, when it reports none, the target is its only
//! possible key window. A sheet or panel the application reports as focused
//! is a window of its own even while attached to the target.

use std::time::{Duration, Instant};

use senpi_desktop_core::error::CoreResult;

use super::key_route::{
    attached_under, decide, key_process, key_refusal, keyboard_conflict, keys_still_reach, owner_still_focused,
    unmapped_keyboard_refusal, KeyDecision, KeyboardConflict,
};
use crate::ax::{self, KeyDestination, KeyFocus};
use crate::skylight;

/// How long the application has to report the target as its key window
/// after the focus-without-raise record, read every [`KEY_WINDOW_POLL`].
const KEY_WINDOW_TIMEOUT: Duration = Duration::from_millis(250);
const KEY_WINDOW_POLL: Duration = Duration::from_millis(10);

/// A window whose background keys were proven to reach it: the process to
/// post them to and the focus that proved it.
#[derive(Clone, Copy, Debug)]
pub(super) struct PreparedKeys {
    pid: libc::pid_t,
    wid: u32,
    /// The process and window that take the keys: the window's own, or the
    /// one drawing a system panel's content.
    owner: (libc::pid_t, u32),
    proven: KeyFocus,
}

impl PreparedKeys {
    /// The process to post the keys to.
    pub(super) const fn process(&self) -> libc::pid_t {
        self.owner.0
    }

    /// Before every press: the focus that proved the keys still routes them
    /// to the window, and a drawing process still reports focus there.
    pub(super) fn recheck(&self) -> CoreResult<()> {
        keys_still_reach(
            self.pid,
            self.wid,
            || keyboard_conflict_now(self.pid, self.wid),
            self.proven,
            || ax::key_focus(self.pid),
            skylight::window_parent,
        )?;
        owner_still_focused(self.pid, self.wid, self.owner, ax::focused_window_id)
    }
}

/// Prepares background keys for `window`: refuses an unmapped target or one
/// whose attached sheet holds the focus before anything is posted, makes the
/// window key in its application without raising it, waits until the
/// application proves the keys reach it, and names the process that takes
/// them. A refusal here is `BackgroundUnavailable` (or `InvalidTarget` for
/// a target behind its own sheet): nothing was sent.
pub(super) fn prepare(pid: libc::pid_t, wid: u32) -> CoreResult<PreparedKeys> {
    let conflict = keyboard_conflict_now(pid, wid);
    if conflict == Some(KeyboardConflict::Unmapped) {
        return Err(unmapped_keyboard_refusal(wid));
    }
    let focus = ax::key_focus(pid);
    // The target cannot become key while a window attached to it has focus,
    // so waiting for that would only delay the same refusal.
    let destination = focus.destination(pid, wid, skylight::window_parent);
    if let KeyDestination::Other(Some(other)) = destination {
        if attached_under(other, skylight::window_parent, |parent| parent == wid) {
            return Err(key_refusal(wid, destination, conflict, skylight::window_parent));
        }
    }
    skylight::activate_without_raise(pid, wid)?;
    let (to, proven) = await_key_destination(pid, wid, conflict)?;
    let owner = key_process(to, wid, &proven, || ax::window_content(pid, wid), ax::focused_window_id)?;
    if owner.0 != pid {
        // A process that does not believe it is active still takes typing
        // into its focused field, but not the keys that press a window's
        // default or cancel button (Return in a Save sheet).
        skylight::activate_without_raise(owner.0, owner.1)?;
    }
    Ok(PreparedKeys {
        pid,
        wid,
        owner,
        proven,
    })
}

/// [`keyboard_conflict`] for window `wid` of `pid` as its accessibility
/// windows are now.
fn keyboard_conflict_now(pid: libc::pid_t, wid: u32) -> Option<KeyboardConflict> {
    ax::window_records(pid).map_or(Some(KeyboardConflict::Unmapped), |records| {
        keyboard_conflict(wid, &records, || {
            ax::focused_window_id(pid) == Some(wid)
                || attached_under(wid, skylight::window_parent, |parent| {
                    records.iter().any(|record| record.id == Some(parent))
                })
        })
    })
}

/// Waits until keystrokes posted now would reach `wid`, which the
/// application handles the focus record to establish, and returns the
/// process to post them to with the focus that proved it.
fn await_key_destination(pid: libc::pid_t, wid: u32, conflict: Option<KeyboardConflict>) -> CoreResult<(libc::pid_t, KeyFocus)> {
    let deadline = Instant::now() + KEY_WINDOW_TIMEOUT;
    loop {
        let focus = ax::key_focus(pid);
        let destination = focus.destination(pid, wid, skylight::window_parent);
        if let KeyDecision::Deliver(to) = decide(pid, destination, conflict) {
            return Ok((to, focus));
        }
        if Instant::now() >= deadline {
            return Err(key_refusal(wid, destination, conflict, skylight::window_parent));
        }
        std::thread::sleep(KEY_WINDOW_POLL);
    }
}

/// A stop check that also re-proves the route before every press.
pub(super) fn rechecking<'a>(
    prepared: &'a PreparedKeys,
    check_stop: &'a dyn Fn() -> CoreResult<()>,
) -> impl Fn() -> CoreResult<()> + 'a {
    move || {
        check_stop()?;
        prepared.recheck()
    }
}
