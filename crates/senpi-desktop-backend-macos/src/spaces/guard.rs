//! The focus guard around a background Space move: should the target's
//! application come forward without the user picking it, the previous front
//! window is put back. A front application the user chose meanwhile stays.

use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

use crate::{focus, front_app};

/// Whether the guard sends the target back: it came forward during the move
/// and was not the user's front application before it.
pub(super) fn sends_back(previous: Option<libc::pid_t>, target: libc::pid_t, front_now: Option<libc::pid_t>) -> bool {
    previous.is_some_and(|previous| previous != target) && front_now == Some(target)
}

pub(super) fn with_background_guard(pid: libc::pid_t, action: &mut dyn FnMut() -> CoreResult<()>) -> CoreResult<()> {
    let previous = focus::front_window().map_err(|error| {
        DesktopError::space_move_denied(format!(
            "cannot read the user's front window before the move ({error}); nothing was moved"
        ))
    })?;
    let result = action();
    let Some(previous) = previous else {
        return result;
    };
    let previous_pid = libc::pid_t::try_from(previous.pid).ok();
    if !sends_back(previous_pid, pid, front_app::current_front_pid()) {
        return result;
    }
    match focus::restore_front_window(&previous) {
        Ok(()) => result,
        Err(restore) => {
            let after = result.err().map_or_else(String::new, |error| format!(" after: {error}"));
            Err(DesktopError::new(
                ErrorCode::FocusRestoreFailed,
                format!("the moved window's application came forward and {} could not be put back ({restore}){after}", previous.app),
            ))
        }
    }
}
