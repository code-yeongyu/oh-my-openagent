//! Pressing a key chord: keys go down in order and come up in reverse, with
//! the stop check before every press.

use std::thread;
use std::time::Duration;

use core_graphics::event::CGEventFlags;
use core_graphics::event_source::CGEventSource;
use senpi_desktop_core::backend::Modifiers;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;

use super::cgevent::modifier_flags;
use super::held::{Held, KeyRoute};
use super::keys::{key_code, post_key, update_modifier};

pub(super) fn chord(
    source: &CGEventSource,
    held: &mut Held,
    keys: &[KeyName],
    route: KeyRoute,
    check_stop: &dyn Fn() -> CoreResult<()>,
) -> CoreResult<()> {
    press_chord(keys, check_stop, |code, down, flags| {
        post_key(source, held, code, None, down, flags, route)
    })
}

/// The chord over `post`, which sends one key event. `check_stop` runs before
/// every key-down, so a stop or a cancellation lands between presses; the keys
/// already down are released in reverse, keeping the running modifier flags
/// faithful, before the first error is reported.
fn press_chord(
    keys: &[KeyName],
    check_stop: &dyn Fn() -> CoreResult<()>,
    mut post: impl FnMut(u16, bool, CGEventFlags) -> CoreResult<()>,
) -> CoreResult<()> {
    if keys.is_empty() {
        return Err(DesktopError::invalid_key("key chord must not be empty"));
    }
    let mut active = Modifiers::default();
    let mut down = 0;
    let mut pressed = Ok(());
    for &key in keys {
        pressed = check_stop().and_then(|()| {
            update_modifier(&mut active, key, true);
            post(key_code(key)?, true, modifier_flags(active))
        });
        if pressed.is_err() {
            break;
        }
        down += 1;
        thread::sleep(Duration::from_millis(8));
    }
    let mut released = Ok(());
    for &key in keys[..down].iter().rev() {
        update_modifier(&mut active, key, false);
        let up = key_code(key).and_then(|code| post(code, false, modifier_flags(active)));
        if released.is_ok() {
            released = up;
        }
        thread::sleep(Duration::from_millis(8));
    }
    match (pressed, released) {
        (Err(mut primary), Err(release)) => {
            primary.message = format!("{}; releasing the pressed keys also failed: {release}", primary.message);
            Err(primary)
        }
        (pressed, released) => pressed.and(released),
    }
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
    use senpi_desktop_core::keys::KeyName;

    use super::press_chord;
    use crate::skylight::{mark_sent, reporting_partial};

    const META: u16 = 55;
    const V: u16 = 9;

    fn proceed() -> CoreResult<()> {
        Ok(())
    }

    #[test]
    fn a_stop_between_presses_sends_no_further_key_and_releases_the_ones_down() {
        let checks = Cell::new(0);
        let posted = RefCell::new(Vec::new());
        let check_stop = || {
            checks.set(checks.get() + 1);
            if checks.get() == 2 {
                Err(DesktopError::new(ErrorCode::Cancelled, "the request was cancelled while pressing keys"))
            } else {
                Ok(())
            }
        };
        let error = press_chord(&[KeyName::Meta, KeyName::Char('v')], &check_stop, |code, down, _| {
            posted.borrow_mut().push((code, down));
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert_eq!(*posted.borrow(), [(META, true), (META, false)]);
    }

    #[test]
    fn every_press_runs_the_stop_check_and_releases_reverse_the_presses() {
        let checks = Cell::new(0);
        let posted = RefCell::new(Vec::new());
        let check_stop = || {
            checks.set(checks.get() + 1);
            Ok(())
        };
        press_chord(&[KeyName::Meta, KeyName::Char('v')], &check_stop, |code, down, _| {
            posted.borrow_mut().push((code, down));
            Ok(())
        })
        .unwrap();
        assert_eq!(checks.get(), 2);
        assert_eq!(*posted.borrow(), [(META, true), (V, true), (V, false), (META, false)]);
    }

    /// Background posts mark the call sent (`skylight::post_keyboard`); the
    /// fake post does the same and then refuses its `refuse_at`-th event.
    fn refused_chord(refuse_at: usize) -> DesktopError {
        let events = Cell::new(0);
        reporting_partial(|| {
            press_chord(&[KeyName::Meta, KeyName::Char('v')], &proceed, |_, _, _| {
                let index = events.get();
                events.set(index + 1);
                if index == refuse_at {
                    return Err(DesktopError::background_unavailable(
                        "window 41 did not become its application's key window; nothing was sent",
                    ));
                }
                mark_sent();
                Ok(())
            })
        })
        .unwrap_err()
    }

    #[test]
    fn a_post_refused_before_any_key_went_out_stays_background_unavailable() {
        assert_eq!(refused_chord(0).code, ErrorCode::BackgroundUnavailable);
    }

    #[test]
    fn a_post_refused_after_one_key_went_out_becomes_input_failed() {
        let error = refused_chord(1);
        assert_eq!(error.code, ErrorCode::InputFailed);
        assert!(error.message.contains("may already have landed"), "{}", error.message);
    }
}
