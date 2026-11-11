//! Where a background keyboard target stands relative to the user's own front
//! application, read before and during the input; decisions only (ported from
//! oh-my-pi 18.13.1 `macos/input.rs` `EntryFront`, `front_target`,
//! `front_refusal`, `recheck_background`).

use senpi_desktop_core::error::{CoreResult, DesktopError};

/// Where the target window stands relative to the user's keyboard focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FrontTarget {
    /// Another application is frontmost.
    Background,
    /// The frontmost application's keys already go to the target.
    Key,
    /// The target's application came to the front after the input began, so
    /// the user may just have picked one of its windows.
    CameForward,
    /// The target is another window of the frontmost application, whose key
    /// window takes the user's typing.
    UserSibling,
    /// The front process could not be read.
    Unknown,
}

/// The front process as background input began, read before anything about
/// its target: a probe of the target can block while the user picks it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct EntryFront(pub(super) Option<libc::pid_t>);

impl EntryFront {
    pub(super) fn now() -> Self {
        Self(crate::skylight::front_pid())
    }

    /// Whether `pid`, not the front process as the input began, is now.
    fn came_forward(self, front: Option<libc::pid_t>, pid: libc::pid_t) -> bool {
        front == Some(pid) && self.0 != Some(pid)
    }

    /// Refuses once window `wid`'s `pid` has come to the front (`front`)
    /// since the input began: the user may have just picked it, and a write
    /// would land in the field they took over (omp 18.13.1 `require_behind`).
    pub(super) fn require_behind(self, front: Option<libc::pid_t>, pid: libc::pid_t, wid: u32) -> CoreResult<()> {
        if self.came_forward(front, pid) {
            return Err(front_refusal(FrontTarget::CameForward, wid));
        }
        Ok(())
    }
}

pub(super) fn front_target(
    entry: EntryFront,
    front: Option<libc::pid_t>,
    pid: libc::pid_t,
    takes_keys: impl FnOnce() -> bool,
) -> FrontTarget {
    match front {
        None => FrontTarget::Unknown,
        Some(front) if front != pid => FrontTarget::Background,
        Some(_) if entry.came_forward(front, pid) => FrontTarget::CameForward,
        Some(_) if takes_keys() => FrontTarget::Key,
        Some(_) => FrontTarget::UserSibling,
    }
}

/// The refusal for a target whose front state forbids making its window key
/// behind the user's app; only an unknown front app may be retried in
/// takeover. Nothing was sent.
pub(super) fn front_refusal(front: FrontTarget, wid: u32) -> DesktopError {
    match front {
        FrontTarget::UserSibling => DesktopError::user_intervened(format!(
            "window {wid} belongs to the frontmost application but is not its key window; making it \
             key would move the user's typing there, so nothing was sent",
        )),
        FrontTarget::Unknown => DesktopError::background_unavailable(format!(
            "window {wid}: the frontmost application could not be identified, so making the window \
             key could move the user's typing there; nothing was sent",
        )),
        FrontTarget::CameForward | FrontTarget::Background | FrontTarget::Key => DesktopError::user_intervened(
            format!("window {wid}'s application came to the front while background input was prepared, so nothing was sent"),
        ),
    }
}

/// The check before each later press of background input for window `wid`
/// of `pid`: `target_holds` must pass, and when the application was behind
/// the user's (`prepared`), it must still be: `front` is read last, as close
/// to the press as it can be.
pub(super) fn recheck_background(
    prepared: bool,
    pid: libc::pid_t,
    wid: u32,
    front: impl FnOnce() -> Option<libc::pid_t>,
    target_holds: impl FnOnce() -> CoreResult<()>,
) -> CoreResult<()> {
    target_holds()?;
    if !prepared {
        return Ok(());
    }
    match front() {
        Some(front) if front != pid => Ok(()),
        Some(_) => Err(DesktopError::user_intervened(format!(
            "window {wid}'s application came to the front during background input; no further input \
             was sent; inspect the window",
        ))),
        None => Err(DesktopError::background_unavailable(format!(
            "the front application could not be identified during background input, so window {wid}'s \
             application may be in front; nothing was sent",
        ))),
    }
}

#[cfg(test)]
mod tests {
    use senpi_desktop_core::error::{DesktopError, ErrorCode};

    use super::{front_refusal, front_target, recheck_background, EntryFront, FrontTarget};

    const USER: libc::pid_t = 1;
    const TARGET: libc::pid_t = 2;

    #[test]
    fn only_a_target_behind_the_users_app_is_made_key() {
        let behind = EntryFront(Some(USER));
        assert_eq!(front_target(behind, Some(USER), TARGET, || false), FrontTarget::Background);
        assert_eq!(front_target(behind, None, TARGET, || true), FrontTarget::Unknown);
        assert_eq!(front_target(behind, Some(TARGET), TARGET, || true), FrontTarget::CameForward);
        let front = EntryFront(Some(TARGET));
        assert_eq!(front_target(front, Some(TARGET), TARGET, || true), FrontTarget::Key);
        // Another window of the app the user types into is never made key.
        assert_eq!(front_target(front, Some(TARGET), TARGET, || false), FrontTarget::UserSibling);
        assert_eq!(front_refusal(FrontTarget::UserSibling, 7).code, ErrorCode::UserIntervened);
        assert_eq!(front_refusal(FrontTarget::Unknown, 7).code, ErrorCode::BackgroundUnavailable);
    }

    #[test]
    fn a_write_refuses_once_the_target_came_forward() {
        let behind = EntryFront(Some(USER));
        assert!(behind.require_behind(Some(USER), TARGET, 7).is_ok());
        assert_eq!(behind.require_behind(Some(TARGET), TARGET, 7).unwrap_err().code, ErrorCode::UserIntervened);
        // A target already in front as the input began did not come forward.
        assert!(EntryFront(Some(TARGET)).require_behind(Some(TARGET), TARGET, 7).is_ok());
    }

    #[test]
    fn a_target_brought_forward_mid_input_stops_the_next_press() {
        // Given: the target was made key behind the user's app
        let holds = || Ok(());
        // Then: it may go on only while another app is in front
        assert!(recheck_background(true, TARGET, 7, || Some(USER), holds).is_ok());
        let came = recheck_background(true, TARGET, 7, || Some(TARGET), holds).unwrap_err();
        assert_eq!(came.code, ErrorCode::UserIntervened);
        assert!(recheck_background(false, TARGET, 7, || Some(TARGET), holds).is_ok());
        let lost = || Err(DesktopError::input_failed("focus left"));
        assert_eq!(recheck_background(false, TARGET, 7, || Some(USER), lost).unwrap_err().code, ErrorCode::InputFailed);
    }
}
