//! Bounded input ownership and cleanup shared by native backends.

use std::panic::{catch_unwind, AssertUnwindSafe};

use crate::backend::MouseButton;
use crate::error::{CoreResult, DesktopError, ErrorCode};
use crate::keys::KeyName;

/// A mouse hold in global logical coordinates, already mapped by the session.
pub struct MouseHold<'a> {
    pub x: f64,
    pub y: f64,
    pub button: MouseButton,
    pub keys: &'a [KeyName],
}

/// The session supplies both checks between presses and the interruptible
/// wait; cleanup intentionally calls neither.
pub struct HoldControl<'a> {
    pub check: &'a dyn Fn() -> CoreResult<()>,
    pub wait: &'a dyn Fn() -> CoreResult<()>,
}

/// Press in order, execute while held, release every attempted press in
/// reverse. Failed presses may have delivered partial input. Cleanup never
/// replaces the primary error and never stops at its first failed release.
pub fn with_held<C, K: Copy>(
    context: &mut C,
    keys: &[K],
    check: &dyn Fn() -> CoreResult<()>,
    mut transition: impl FnMut(&mut C, K, bool) -> CoreResult<()>,
    operation: impl FnOnce(&mut C) -> CoreResult<()>,
) -> CoreResult<()> {
    let mut attempted = 0;
    let mut result = Ok(());
    for &key in keys {
        result = guarded(check);
        if result.is_err() {
            break;
        }
        attempted += 1;
        result = guarded(|| transition(context, key, true));
        if result.is_err() {
            break;
        }
    }
    if result.is_ok() {
        result = guarded(|| operation(context));
    }
    for &key in keys[..attempted].iter().rev() {
        merge_release(&mut result, guarded(|| transition(context, key, false)));
    }
    result
}

const RELEASE_ALSO_FAILED: &str = "; input release also failed: ";

/// Whether a hold's error carries an input-release failure: either the release
/// itself failed, or it failed after a cancel or stop (merged by
/// [`merge_release`]). A caller that answers `Cancelled` must surface these.
#[must_use]
pub fn reports_release_failure(error: &DesktopError) -> bool {
    error.code != ErrorCode::Cancelled || error.message.contains(RELEASE_ALSO_FAILED)
}

/// Append a cleanup failure without discarding the original failure/code.
pub fn merge_release(result: &mut CoreResult<()>, released: CoreResult<()>) {
    if let Err(release) = released {
        match result {
            Ok(()) => *result = Err(release),
            Err(primary) => {
                primary.message.push_str(RELEASE_ALSO_FAILED);
                primary.message.push_str(&release.to_string());
            }
        }
    }
}

fn guarded(action: impl FnOnce() -> CoreResult<()>) -> CoreResult<()> {
    catch_unwind(AssertUnwindSafe(action))
        .unwrap_or_else(|_| Err(DesktopError::internal("the held input backend panicked")))
}

#[cfg(test)]
mod release_failure_tests {
    use super::{merge_release, reports_release_failure};
    use crate::error::{CoreResult, DesktopError, ErrorCode};

    fn cancelled() -> DesktopError {
        DesktopError::new(ErrorCode::Cancelled, "the hold request was cancelled")
    }

    #[test]
    fn a_plain_cancel_is_not_a_release_failure() {
        assert!(!reports_release_failure(&cancelled()));
    }

    #[test]
    fn a_cancel_whose_release_failed_is_a_release_failure() {
        let mut outcome: CoreResult<()> = Err(cancelled());
        merge_release(&mut outcome, Err(DesktopError::input_failed("key up failed")));
        assert!(reports_release_failure(&outcome.unwrap_err()));
    }

    #[test]
    fn a_release_failure_after_a_clean_hold_is_a_release_failure() {
        let mut outcome: CoreResult<()> = Ok(());
        merge_release(&mut outcome, Err(DesktopError::input_failed("key up failed")));
        assert!(reports_release_failure(&outcome.unwrap_err()));
    }
}
