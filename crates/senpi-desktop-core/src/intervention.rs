//! The seam of the user-intervention check (#11459). The session admits each
//! mutating request and installs its press check on the session thread for
//! that request; backends call [`check_press`] before every key or pointer
//! press and every model-requested AX action or write. Releases and focus
//! restores never call it, so a refusal never strands held input. With no
//! check installed, every press passes.

use std::cell::Cell;
use std::marker::PhantomData;

use crate::error::CoreResult;

/// A press check: `Err` refuses the press about to be sent.
pub type PressCheck = fn() -> CoreResult<()>;

thread_local! {
    static PRESS_CHECK: Cell<Option<PressCheck>> = const { Cell::new(None) };
}

/// Keeps a press check installed on this thread until dropped; the check it
/// replaced is installed again then.
#[must_use = "the press check is uninstalled when the watch drops"]
pub struct PressWatch {
    previous: Option<PressCheck>,
    /// The watch restores this thread's slot, so it never leaves the thread.
    _thread: PhantomData<*const ()>,
}

/// Installs `check` as this thread's press check for the watch's lifetime.
pub fn watch(check: PressCheck) -> PressWatch {
    PressWatch {
        previous: PRESS_CHECK.replace(Some(check)),
        _thread: PhantomData,
    }
}

impl Drop for PressWatch {
    fn drop(&mut self) {
        PRESS_CHECK.set(self.previous);
    }
}

/// Runs this thread's press check before a press; `Ok` when none is
/// installed.
///
/// # Errors
/// The installed check's refusal: nothing more of the call may be sent.
pub fn check_press() -> CoreResult<()> {
    PRESS_CHECK.get().map_or(Ok(()), |check| check())
}

#[cfg(test)]
mod tests {
    use super::{check_press, watch};
    use crate::error::{CoreResult, DesktopError, ErrorCode};

    fn refuse() -> CoreResult<()> {
        Err(DesktopError::user_intervened("the user clicked in the app"))
    }

    fn pass() -> CoreResult<()> {
        Ok(())
    }

    #[test]
    fn the_installed_check_runs_until_its_watch_drops() {
        assert!(check_press().is_ok(), "no check installed lets every press through");
        let outer = watch(refuse);
        assert_eq!(check_press().map_err(|error| error.code), Err(ErrorCode::UserIntervened));
        {
            let _inner = watch(pass);
            assert!(check_press().is_ok(), "a nested request's check replaces the outer one");
        }
        assert_eq!(
            check_press().map_err(|error| error.code),
            Err(ErrorCode::UserIntervened),
            "dropping the nested watch restores the outer check"
        );
        drop(outer);
        assert!(check_press().is_ok());
    }

    #[test]
    fn a_check_installed_on_one_thread_does_not_reach_another() {
        let _watch = watch(refuse);
        let elsewhere = std::thread::spawn(check_press).join();
        assert!(matches!(elsewhere, Ok(Ok(()))));
    }
}
