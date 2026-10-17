//! Readies a window for foreground input: its application front and the window
//! raised, main and focused (key)
//! before anything is posted to it. Input posted to a window that is not key
//! is consumed as the activation click (or goes to another window), so the
//! foreground rung refuses rather than reporting undelivered input as success.

use std::thread;
use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

use super::{actions, element, tree};

/// How long a raised window may take to report itself main and focused.
const KEY_DEADLINE: Duration = Duration::from_millis(500);
const KEY_POLL: Duration = Duration::from_millis(10);

/// Raises `window`, marks it main/focused, and waits until its application is
/// frontmost and reports it as the main, focused window. An application that
/// does not expose one of those signals cannot be verified and proceeds.
///
/// # Errors
/// `InputFailed` when the window still reports that it is not main and
/// focused after [`KEY_DEADLINE`].
pub(crate) fn prepare_foreground_input(window: &DesktopWindow) -> CoreResult<()> {
    let Ok(root) = tree::window_root(window) else {
        return Ok(());
    };
    let app = window
        .pid
        .and_then(|pid| libc::pid_t::try_from(pid).ok())
        .and_then(|pid| element::create_application(pid).ok());
    let _ = actions::set_window_main_and_focused(&root);
    let _ = actions::perform(&root, "AXRaise");
    let started = Instant::now();
    loop {
        let observed = KeyObservation {
            frontmost: app.as_deref().and_then(|app| element::copy_bool(app, "AXFrontmost")),
            main: element::copy_bool(&root, "AXMain"),
            focused_window_is_target: app.as_deref().and_then(|app| {
                let focused = element::copy_element(app, "AXFocusedWindow")?;
                Some(element::window_id(&focused)? == element::window_id(&root)?)
            }),
        };
        match key_state(observed) {
            KeyState::Ready | KeyState::Unverifiable => return Ok(()),
            KeyState::NotYet if started.elapsed() >= KEY_DEADLINE => {
                return Err(DesktopError::input_failed(format!(
                    "window {} did not become the key window for foreground input within {} ms \
                     ({observed:?}); nothing was posted. Retry, or use delivery:\"background\" or ax actions",
                    window.id,
                    KEY_DEADLINE.as_millis()
                )));
            }
            KeyState::NotYet => thread::sleep(KEY_POLL),
        }
    }
}

/// What the application reports about its front state. A key window reports
/// `AXMain` and is the application's `AXFocusedWindow`; a window's own
/// `AXFocused` stays false even while it is key, so it is not consulted.
/// Makes `pid` the frontmost application through accessibility, the route an
/// Accessibility-trusted process is allowed to use under cooperative activation.
/// Returns whether the write was accepted.
pub(crate) fn make_frontmost(pid: libc::pid_t) -> bool {
    element::create_application(pid).is_ok_and(|app| actions::set_bool(&app, "AXFrontmost", true).is_ok())
}

#[derive(Debug, Clone, Copy)]
struct KeyObservation {
    frontmost: Option<bool>,
    main: Option<bool>,
    focused_window_is_target: Option<bool>,
}

#[derive(Debug, PartialEq, Eq)]
enum KeyState {
    Ready,
    NotYet,
    Unverifiable,
}

fn key_state(observed: KeyObservation) -> KeyState {
    match (observed.frontmost, observed.main, observed.focused_window_is_target) {
        (Some(true), Some(true), Some(true)) => KeyState::Ready,
        (None, _, _) | (_, None, _) | (_, _, None) => KeyState::Unverifiable,
        _ => KeyState::NotYet,
    }
}

#[cfg(test)]
mod tests {
    use super::{key_state, KeyObservation, KeyState};

    const fn observed(frontmost: Option<bool>, main: Option<bool>, target: Option<bool>) -> KeyObservation {
        KeyObservation { frontmost, main, focused_window_is_target: target }
    }

    #[test]
    fn a_window_is_ready_when_its_app_is_front_and_it_is_the_main_focused_window() {
        assert_eq!(key_state(observed(Some(true), Some(true), Some(true))), KeyState::Ready);
    }

    #[test]
    fn a_window_is_not_ready_while_any_front_signal_is_false() {
        assert_eq!(key_state(observed(Some(false), Some(true), Some(true))), KeyState::NotYet);
        assert_eq!(key_state(observed(Some(true), Some(false), Some(true))), KeyState::NotYet);
        assert_eq!(key_state(observed(Some(true), Some(true), Some(false))), KeyState::NotYet);
    }

    #[test]
    fn a_window_whose_app_hides_a_front_signal_cannot_be_verified() {
        assert_eq!(key_state(observed(None, Some(true), Some(true))), KeyState::Unverifiable);
        assert_eq!(key_state(observed(Some(true), None, Some(false))), KeyState::Unverifiable);
        assert_eq!(key_state(observed(Some(false), Some(false), None)), KeyState::Unverifiable);
    }
}
