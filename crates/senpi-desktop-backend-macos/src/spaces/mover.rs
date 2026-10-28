//! The `window.bringToCurrentSpace` algorithm over a [`SpaceServer`], so the
//! decisions are unit-tested without WindowServer. Ported from oh-my-pi
//! `desktop/macos/spaces.rs` (MIT): never switch Spaces, never activate.

use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError};

/// How long a requested move may take to show in the window's memberships.
pub(super) const MOVE_DEADLINE: Duration = Duration::from_millis(1200);
/// How often the memberships are read back while the move settles.
pub(super) const MOVE_POLL: Duration = Duration::from_millis(25);

/// A WindowServer Space id; never mixed up with a window number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct SpaceId(pub(super) u64);

/// The user's focus as WindowServer and AX report it: the front process and
/// its key window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct FrontContext {
    pub(super) pid: libc::pid_t,
    pub(super) window: u32,
}

/// What the algorithm reads from and asks of WindowServer.
pub(super) trait SpaceServer {
    /// The process owning window `wid`, resolved through WindowServer (the
    /// target is normally off the current Space, so capture lists miss it).
    fn owner_pid(&self, wid: u32) -> CoreResult<libc::pid_t>;
    /// The user's current Space; an error when WindowServer names none.
    fn active_space(&self) -> CoreResult<SpaceId>;
    /// `0` for an ordinary desktop Space; anything else is fullscreen or
    /// system-managed.
    fn space_type(&self, space: SpaceId) -> i32;
    /// Window `wid`'s Space memberships, sorted and deduplicated; an error
    /// when they are unreadable or empty.
    fn memberships(&self, wid: u32) -> CoreResult<Vec<SpaceId>>;
    /// Every managed display with the Space it shows, sorted.
    fn display_spaces(&self) -> CoreResult<Vec<(String, SpaceId)>>;
    /// Requests the move; WindowServer gives no result, so callers verify.
    fn move_window(&self, wid: u32, space: SpaceId);
    /// The user's focus, `None` when it cannot be established.
    fn front_context(&self) -> Option<FrontContext>;
    /// Runs `action` while sending `pid` back should it come forward.
    fn with_background_guard(&self, pid: libc::pid_t, action: &mut dyn FnMut() -> CoreResult<()>) -> CoreResult<()>;
    fn now(&self) -> Instant;
    fn wait(&self, duration: Duration);
}

fn denied(message: impl Into<String>) -> DesktopError {
    DesktopError::space_move_denied(message)
}

/// Window `id` as a WindowServer window number.
pub(super) fn window_number(id: &str) -> CoreResult<u32> {
    id.parse::<u32>()
        .ok()
        .filter(|wid| *wid != 0)
        .ok_or_else(|| DesktopError::invalid_target(format!("'{id}' is not a native window id for Space movement")))
}

/// Moves window `id` into the user's current Space. Refuses before any move
/// when the current Space is fullscreen or system-managed, leaves a window
/// that is already a member alone, and fails `SpaceMoveDenied` when the move
/// cannot be verified or the user's Space or focus changed meanwhile.
pub(super) fn bring(server: &impl SpaceServer, id: &str, check_stop: &dyn Fn() -> CoreResult<()>) -> CoreResult<()> {
    check_stop()?;
    let wid = window_number(id)?;
    let pid = server.owner_pid(wid)?;
    let current = server.active_space()?;
    // Moving another application's window into a fullscreen/system Space is
    // not an ordinary desktop move and can violate its ownership semantics.
    if server.space_type(current) != 0 {
        return Err(denied(
            "the current Space is fullscreen or system-managed; leave fullscreen or choose a desktop Space, then retry",
        ));
    }
    if server.memberships(wid)?.contains(&current) {
        // Already visible here (including windows pinned to all Spaces).
        return Ok(());
    }
    let focus = server.front_context().ok_or_else(|| {
        denied("cannot establish the user's current focus; grant Accessibility access before moving a background window")
    })?;
    let displays = server.display_spaces()?;
    let result = server.with_background_guard(pid, &mut || {
        verify_owner(server, wid, pid)?;
        if server.active_space()? != current || server.display_spaces()? != displays {
            return Err(denied(
                "the active Space changed before dispatch; no move was requested, retry from the intended desktop Space",
            ));
        }
        check_stop()?;
        server.move_window(wid, current);
        settle(server, wid, pid, current, check_stop)
    });
    // Checked after the guard finished, not merely after the request. A Space
    // is never restored and a newer focus choice of the user's never undone.
    let unchanged = server.active_space()? == current
        && server.display_spaces()? == displays
        && server.front_context() == Some(focus);
    if !unchanged {
        let after = result.err().map_or_else(String::new, |error| format!(" ({error})"));
        return Err(denied(format!(
            "the user's Space or focus changed during movement of window {wid}; the window may already have moved{after}. \
             Inspect the desktop before retrying; no Space switch was requested"
        )));
    }
    result
}

/// Polls the memberships until the window is on `current` alone.
fn settle(
    server: &impl SpaceServer,
    wid: u32,
    pid: libc::pid_t,
    current: SpaceId,
    check_stop: &dyn Fn() -> CoreResult<()>,
) -> CoreResult<()> {
    let deadline = server.now() + MOVE_DEADLINE;
    loop {
        check_stop()?;
        verify_owner(server, wid, pid)?;
        let observed = server.memberships(wid)?;
        if verified_move(current, &observed) {
            return Ok(());
        }
        if server.now() >= deadline {
            let observed: Vec<u64> = observed.iter().map(|space| space.0).collect();
            return Err(denied(format!(
                "WindowServer did not move window {wid} to Space {} (memberships: {observed:?}); macOS may prohibit \
                 this window or this process from moving it. Move it manually in Mission Control; no security \
                 settings were changed",
                current.0
            )));
        }
        server.wait(MOVE_POLL);
    }
}

fn verify_owner(server: &impl SpaceServer, wid: u32, expected: libc::pid_t) -> CoreResult<()> {
    if server.owner_pid(wid)? != expected {
        return Err(DesktopError::window_not_found(format!(
            "window {wid} no longer belongs to process {expected}; Space move refused"
        )));
    }
    Ok(())
}

/// Only exact membership of the current Space proves the move; an ignored or
/// partial one does not.
pub(super) fn verified_move(current: SpaceId, observed: &[SpaceId]) -> bool {
    current.0 != 0 && observed == [current]
}

/// Whether one of the windows whose memberships are `memberships` belongs
/// only to Spaces no display shows (`shown`). A window WindowServer keeps
/// ordered out belongs to none, and one on every Space belongs to a shown one
/// too. `None` once a membership is unknown and none seen so far is elsewhere.
pub(super) fn on_another_space(
    shown: &[SpaceId],
    memberships: impl IntoIterator<Item = Option<Vec<SpaceId>>>,
) -> Option<bool> {
    for spaces in memberships {
        let spaces = spaces?;
        if !spaces.is_empty() && !spaces.iter().any(|space| shown.contains(space)) {
            return Some(true);
        }
    }
    Some(false)
}
