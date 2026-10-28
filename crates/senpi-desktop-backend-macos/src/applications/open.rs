//! Opening an application and waiting for its first window. A running
//! application that shows a window is not opened again: Launch Services
//! would send it the reopen event, which Notes and Contacts answer by
//! activating themselves. One without a window on screen is asked to show
//! one without activation ([`show_in_background`]).

use std::cell::RefCell;
use std::ptr::NonNull;
use std::time::{Duration, Instant};

use objc2_application_services::{AXError, AXUIElement};
use objc2_core_foundation::{CFBoolean, CFRetained, CFString, CFType};
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::{Application, DesktopWindow, OpenedApplication};

use super::launch::launch;
use super::windows::{has_onscreen_window, has_open_window, key_capable_windows};
use crate::spaces::window_on_another_space;

/// How long `open` waits for an application's first window: launches show it
/// 0.2-1.3 s after Launch Services confirms them, a cold one up to 3.6 s;
/// Preview without a document never shows one and costs the whole wait.
pub(super) const FIRST_WINDOW_WAIT: Duration = Duration::from_secs(3);
pub(super) const FIRST_WINDOW_POLL: Duration = Duration::from_millis(50);

pub(super) fn open(app: Application, activate: bool, check_stop: &dyn Fn() -> CoreResult<()>) -> CoreResult<OpenedApplication> {
    let wait = || poll_window(check_stop);
    if let Some(pid) = app.pid.filter(|_| app.running && !activate) {
        let path = app.path.clone();
        return open_running(
            app,
            pid,
            key_capable_windows,
            || libc::pid_t::try_from(pid).ok().and_then(has_onscreen_window) == Some(true),
            |relaunched| show_in_background(pid, &path, relaunched, check_stop),
            wait,
        );
    }
    let application = launch(&app.path, activate, check_stop)?;
    let window = match application.pid {
        Some(pid) => first_window(false, FIRST_WINDOW_WAIT, || key_capable_windows(pid), || false, || false, wait)?,
        None => None,
    };
    Ok(OpenedApplication::new(application, window))
}

/// [`open`] for `app` running as `pid`: its first window, asking for one
/// through `request_window` when it shows none. The application may have
/// exited since it was listed; the reopen event then launches it again under
/// a new pid, which `request_window` reports, and the windows are read, and
/// the application returned, as that process.
pub(super) fn open_running(
    app: Application,
    pid: u32,
    mut windows_of: impl FnMut(u32) -> Option<Vec<DesktopWindow>>,
    unlisted_window: impl FnOnce() -> bool,
    request_window: impl FnOnce(&mut dyn FnMut(Application)) -> bool,
    wait: impl FnMut() -> CoreResult<()>,
) -> CoreResult<OpenedApplication> {
    let relaunched = RefCell::new(None::<Application>);
    let current = || relaunched.borrow().as_ref().and_then(|app| app.pid).unwrap_or(pid);
    let window = first_window(
        true,
        FIRST_WINDOW_WAIT,
        || windows_of(current()),
        unlisted_window,
        || request_window(&mut |launched| *relaunched.borrow_mut() = Some(launched)),
        wait,
    )?;
    Ok(OpenedApplication::new(relaunched.into_inner().unwrap_or(app), window))
}

/// The application's frontmost window, given until `timeout` to show its
/// first one. With `show`, a running application without a window is asked
/// to show one first; one whose on-screen windows the list leaves out
/// (`unlisted_window`) already shows one and is not asked. No window list
/// means no window.
pub(super) fn first_window(
    show: bool,
    timeout: Duration,
    mut windows: impl FnMut() -> Option<Vec<DesktopWindow>>,
    unlisted_window: impl FnOnce() -> bool,
    request_window: impl FnOnce() -> bool,
    mut wait: impl FnMut() -> CoreResult<()>,
) -> CoreResult<Option<DesktopWindow>> {
    let deadline = Instant::now() + timeout;
    let Some(mut shown) = windows() else {
        return Ok(None);
    };
    if shown.is_empty() && show && (unlisted_window() || !request_window()) {
        return Ok(None);
    }
    while shown.is_empty() && Instant::now() < deadline {
        wait()?;
        shown = windows().unwrap_or_default();
    }
    Ok(shown.into_iter().next())
}

fn show_in_background(
    pid: u32,
    path: &str,
    relaunched: &mut dyn FnMut(Application),
    check_stop: &dyn Fn() -> CoreResult<()>,
) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: AXUIElementCreateApplication accepts any process id.
    let app = unsafe { AXUIElement::new_application(pid) };
    let hidden = CFString::from_static_str("AXHidden");
    let mut value: *const CFType = std::ptr::null();
    // SAFETY: `value` is writable and receives a +1 CF object on success.
    let read = unsafe { app.copy_attribute_value(&hidden, NonNull::from(&mut value)) };
    let is_hidden = (read == AXError::Success)
        // SAFETY: A successful copy transferred one retained object to us.
        .then(|| NonNull::new(value.cast_mut()).map(|value| unsafe { CFRetained::from_raw(value) }))
        .flatten()
        .and_then(|value| value.downcast::<CFBoolean>().ok())
        .is_some_and(|value| value.as_bool());
    ask_for_window(
        is_hidden,
        // SAFETY: The retained element, attribute name and singleton CFBoolean
        // stay valid for the synchronous setter.
        || unsafe { app.set_attribute_value(&hidden, CFBoolean::new(false)) == AXError::Success },
        || has_open_window(pid) != Some(false),
        || window_on_another_space(pid) != Some(false),
        || launch(path, false, check_stop).map(&mut *relaunched).is_ok(),
    )
}

/// Asks for a window: a `hidden` application is unhidden, which shows only the
/// windows it still has open (`open_window`); one whose last window closed
/// also gets the reopen event, as a non-hidden one does. One with a window on
/// another Space (`elsewhere`), or whose Space state cannot be ruled out, is
/// not reopened: the event could bring it in front of the user. `false` when
/// nothing could be asked.
pub(super) fn ask_for_window(
    hidden: bool,
    unhide: impl FnOnce() -> bool,
    open_window: impl FnOnce() -> bool,
    elsewhere: impl FnOnce() -> bool,
    reopen: impl FnOnce() -> bool,
) -> bool {
    if hidden {
        if !unhide() {
            return false;
        }
        if open_window() {
            return true;
        }
    }
    if elsewhere() {
        return false;
    }
    reopen()
}

pub(super) fn poll_window(check_stop: &dyn Fn() -> CoreResult<()>) -> CoreResult<()> {
    check_stop()?;
    std::thread::sleep(FIRST_WINDOW_POLL);
    Ok(())
}
