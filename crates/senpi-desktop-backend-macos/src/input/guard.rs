//! Background-delivery policy: the app guard and the sole-window keyboard
//! rule. Decisions only - no event posting happens here.

use senpi_desktop_core::backend::{MouseButton, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

use crate::capture::MacCapture;
use crate::skylight;

/// Apps that coerce synthetic background right-clicks to left-clicks, and
/// canvas/game engines that drop background events entirely.
const RIGHT_CLICK_COERCERS: [&str; 6] = ["chrome", "chromium", "electron", "brave", "edge", "arc"];
const CANVAS_OR_GAME: [&str; 5] = ["blender", "unity", "godot", "unreal", "ghost"];

/// Refuses background delivery the target app is known to mishandle.
pub(super) fn guard(window: &DesktopWindow, kind: &str, button: Option<MouseButton>) -> CoreResult<()> {
    let app = window.app.to_ascii_lowercase();
    if RIGHT_CLICK_COERCERS.iter().any(|name| app.contains(name)) && button == Some(MouseButton::Right) {
        return Err(DesktopError::background_unavailable(format!(
            "window {} ({}) coerces synthetic background right-click events to left-clicks; retry \
             with delivery:\"foreground\" or use ax actions",
            window.id, window.app,
        )));
    }
    if CANVAS_OR_GAME.iter().any(|name| app.contains(name)) {
        return Err(DesktopError::background_unavailable(format!(
            "window {} ({}) drops background {kind} events in its canvas/game input stack; retry \
             with delivery:\"foreground\" or use ax actions",
            window.id, window.app,
        )));
    }
    Ok(())
}

/// Prepares background keyboard delivery for `window`, or refuses it.
///
/// macOS posts key events to a *process*, which hands them to whichever window
/// it treats as key; unlike pointer events they carry no window id. Delivery is
/// refused whenever the process owns more than one window, rather than typing
/// into another of the user's windows. `DesktopWindow::focused` cannot
/// disambiguate: xcap reports every window owned by the active application as
/// focused on macOS.
pub(super) fn prepare_keys(
    window: &DesktopWindow,
    pid: libc::pid_t,
    wid: u32,
    capture: &MacCapture,
) -> CoreResult<()> {
    let siblings = capture
        .windows()?
        .into_iter()
        .filter(|candidate| candidate.pid == window.pid)
        .count();
    if siblings > 1 {
        return Err(DesktopError::background_unavailable(format!(
            "window {wid} is one of {siblings} windows in its application; macOS delivers \
             background keystrokes to whichever window the application treats as key, so retry \
             with delivery:\"foreground\" or use ax actions",
        )));
    }
    // Sole window of its process, so the target is unambiguous: make it key
    // without raising it or changing the frontmost application. A background app
    // otherwise has no key window and drops the keystrokes entirely.
    skylight::activate_without_raise(pid, wid)
}

pub(super) const fn pointer_kind(event: &PointerEvent) -> &'static str {
    match event {
        PointerEvent::Click { .. } => "click",
        PointerEvent::Move { .. } => "pointer move",
        PointerEvent::Drag { .. } => "drag",
        PointerEvent::Scroll { .. } => "scroll",
    }
}

pub(super) const fn pointer_button(event: &PointerEvent) -> Option<MouseButton> {
    match event {
        PointerEvent::Click { button, .. } | PointerEvent::Drag { button, .. } => Some(*button),
        PointerEvent::Move { .. } | PointerEvent::Scroll { .. } => None,
    }
}
