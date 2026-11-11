//! Bounded input ownership and cleanup shared by native backends.

use std::panic::{catch_unwind, AssertUnwindSafe};

use crate::backend::{Modifiers, MouseButton, PointerEvent};
use crate::error::{CoreResult, DesktopError, ErrorCode};
use crate::keys::KeyName;

/// A mouse hold in global logical coordinates, already mapped by the session.
pub struct MouseHold<'a> {
    pub x: f64,
    pub y: f64,
    pub button: MouseButton,
    pub keys: &'a [KeyName],
}

impl MouseHold<'_> {
    /// The one press this hold opens a menu with, when it would (D1): its
    /// button with its modifier keys down. Ordinary keys do not prevent the
    /// press from opening a menu; a menu-opening hold collapses to this press.
    #[must_use]
    pub fn menu_press(&self) -> PointerEvent {
        let mut modifiers = Modifiers::default();
        for &key in self.keys {
            match key {
                KeyName::Ctrl => modifiers.ctrl = true,
                KeyName::Alt => modifiers.alt = true,
                KeyName::Shift => modifiers.shift = true,
                KeyName::Meta => modifiers.meta = true,
                _ => {}
            }
        }
        PointerEvent::Click {
            x: self.x,
            y: self.y,
            button: self.button,
            count: 1,
            modifiers,
        }
    }
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
        merge_release(
            &mut outcome,
            Err(DesktopError::input_failed("key up failed")),
        );
        assert!(reports_release_failure(&outcome.unwrap_err()));
    }

    #[test]
    fn a_release_failure_after_a_clean_hold_is_a_release_failure() {
        let mut outcome: CoreResult<()> = Ok(());
        merge_release(
            &mut outcome,
            Err(DesktopError::input_failed("key up failed")),
        );
        assert!(reports_release_failure(&outcome.unwrap_err()));
    }
}

#[cfg(test)]
mod menu_press_tests {
    use super::MouseHold;
    use crate::backend::{Modifiers, MouseButton, PointerEvent};
    use crate::keys::KeyName;

    /// The button and modifiers of the one press a hold becomes.
    fn press(
        button: MouseButton,
        keys: &[KeyName],
    ) -> Option<(f64, f64, MouseButton, u32, Modifiers)> {
        let hold = MouseHold {
            x: 3.0,
            y: 4.0,
            button,
            keys,
        };
        match hold.menu_press() {
            PointerEvent::Click {
                x,
                y,
                button,
                count,
                modifiers,
            } => Some((x, y, button, count, modifiers)),
            PointerEvent::Drag { .. } | PointerEvent::Move { .. } | PointerEvent::Scroll { .. } => {
                None
            }
        }
    }

    #[test]
    fn a_hold_becomes_the_press_that_opens_its_menu_even_with_ordinary_keys() {
        let plain = Modifiers::default();
        let ctrl = Modifiers {
            ctrl: true,
            ..Modifiers::default()
        };
        let all = Modifiers {
            ctrl: true,
            alt: true,
            shift: true,
            meta: true,
        };
        assert_eq!(
            press(MouseButton::Right, &[]),
            Some((3.0, 4.0, MouseButton::Right, 1, plain))
        );
        assert_eq!(
            press(MouseButton::Left, &[KeyName::Ctrl]),
            Some((3.0, 4.0, MouseButton::Left, 1, ctrl))
        );
        assert_eq!(
            press(
                MouseButton::Left,
                &[KeyName::Ctrl, KeyName::Alt, KeyName::Shift, KeyName::Meta]
            ),
            Some((3.0, 4.0, MouseButton::Left, 1, all))
        );
        assert_eq!(
            press(MouseButton::Left, &[KeyName::Shift, KeyName::Space]),
            Some((
                3.0,
                4.0,
                MouseButton::Left,
                1,
                Modifiers {
                    shift: true,
                    ..Modifiers::default()
                }
            ))
        );
    }
}
