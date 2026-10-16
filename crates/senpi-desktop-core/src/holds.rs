//! Bounded input ownership and cleanup shared by native backends.

use std::panic::{catch_unwind, AssertUnwindSafe};

use crate::backend::MouseButton;
use crate::error::{CoreResult, DesktopError};
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

/// Append a cleanup failure without discarding the original failure/code.
pub fn merge_release(result: &mut CoreResult<()>, released: CoreResult<()>) {
    if let Err(release) = released {
        match result {
            Ok(()) => *result = Err(release),
            Err(primary) => {
                primary.message.push_str("; input release also failed: ");
                primary.message.push_str(&release.to_string());
            }
        }
    }
}

fn guarded(action: impl FnOnce() -> CoreResult<()>) -> CoreResult<()> {
    catch_unwind(AssertUnwindSafe(action))
        .unwrap_or_else(|_| Err(DesktopError::internal("the held input backend panicked")))
}
