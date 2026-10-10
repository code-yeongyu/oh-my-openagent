//! The application the user sees in front, read live from WindowServer.

use std::sync::atomic::{AtomicI32, Ordering};

use objc2_app_kit::{NSApplicationActivationPolicy, NSRunningApplication, NSWorkspace};

use crate::focus::{window_info, WindowInfo};
use crate::{launch_services, skylight};

/// The application the user sees in front: LaunchServices' front application
/// (the menu-bar owner). Without that SPI, WindowServer's front process when it
/// is a regular app, else the owner of the front-most on-screen normal-layer
/// window of a regular app; an accessory app's floating panel can be
/// WindowServer's front process (#9084). AppKit's view is the last resort; the
/// engine has no run loop to refresh it.
pub(crate) fn current_front_pid() -> Option<libc::pid_t> {
    if let Some(pid) = launch_services::front_application_pid() {
        return Some(pid);
    }
    let Some(front) = skylight::front_pid() else {
        return NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .map(|app| app.processIdentifier());
    };
    let windows = window_info().unwrap_or_default();
    user_front_pid(front, &windows, is_regular_app)
}

fn is_regular_app(pid: libc::pid_t) -> bool {
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .is_some_and(|app| app.activationPolicy() == NSApplicationActivationPolicy::Regular)
}

pub(crate) fn user_front_pid(
    front: libc::pid_t,
    windows: &[WindowInfo],
    is_regular: impl Fn(libc::pid_t) -> bool,
) -> Option<libc::pid_t> {
    if is_regular(front) {
        return Some(front);
    }
    windows
        .iter()
        .filter(|window| window.layer == 0 && window.on_screen)
        .filter_map(|window| libc::pid_t::try_from(window.pid).ok())
        .find(|&pid| is_regular(pid))
        .or(Some(front))
}


/// The last application the engine itself brought to the front (0 = none). A restore may take the front
/// back from this app, but never from one the user switched to afterwards (#9056).
static LAST_ACTIVATED: AtomicI32 = AtomicI32::new(0);

pub(crate) fn note_engine_activation(pid: libc::pid_t) {
    LAST_ACTIVATED.store(pid, Ordering::Relaxed);
}

pub(crate) fn last_engine_activation() -> Option<libc::pid_t> {
    Some(LAST_ACTIVATED.load(Ordering::Relaxed)).filter(|&pid| pid > 0)
}

/// What a restore should do about the app currently in front.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RestoreStep {
    /// The previous app is front: keep watching until it has stayed there.
    Front,
    /// The engine's own activation (or no regular app) holds the front: ask for the previous app again.
    Reclaim,
    /// Another regular app is front: the user moved on; leave it there.
    UserMovedOn,
}

pub(crate) fn restore_step(
    previous: libc::pid_t,
    front: Option<libc::pid_t>,
    engine_activated: Option<libc::pid_t>,
    is_regular: impl Fn(libc::pid_t) -> bool,
) -> RestoreStep {
    match front {
        Some(front) if front == previous => RestoreStep::Front,
        Some(front) if Some(front) == engine_activated || !is_regular(front) => RestoreStep::Reclaim,
        None => RestoreStep::Reclaim,
        Some(_) => RestoreStep::UserMovedOn,
    }
}

pub(crate) fn is_regular(pid: libc::pid_t) -> bool {
    is_regular_app(pid)
}
