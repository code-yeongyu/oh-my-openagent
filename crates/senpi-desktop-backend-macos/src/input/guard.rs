//! Background-delivery policy: the app guard and the sole-window keyboard
//! rule. Decisions only - no event posting happens here.

use std::cell::Cell;

use senpi_desktop_core::backend::{MouseButton, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::report::ReportMode;
use senpi_desktop_core::types::{DesktopWindow, KeyPriming};

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

/// The session options background keys route by, stored by the backend's
/// setters on the session thread that owns it and sends its input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct KeySession {
    priming: KeyPriming,
    report_mode: ReportMode,
}

thread_local! {
    static KEY_SESSION: Cell<KeySession> = const {
        Cell::new(KeySession { priming: KeyPriming::Off, report_mode: ReportMode::Null })
    };
}

/// Stores the session's `macosKeyPriming` option.
pub(crate) fn set_key_priming(priming: KeyPriming) {
    KEY_SESSION.with(|session| session.set(KeySession { priming, ..session.get() }));
}

/// Stores the session's `reportMode`.
pub(crate) fn set_key_report_mode(report_mode: ReportMode) {
    KEY_SESSION.with(|session| session.set(KeySession { report_mode, ..session.get() }));
}

/// How background keys reach the target window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeyDelivery {
    /// Priming off or a `reportMode: "null"` session: the sole-window rule.
    SoleWindow,
    /// Priming on in a `reportMode: "object"` session (DESIGN 7 steps 1-6).
    Primed,
}

fn key_delivery() -> KeyDelivery {
    let session = KEY_SESSION.with(Cell::get);
    if session.priming == KeyPriming::On && session.report_mode == ReportMode::Object {
        KeyDelivery::Primed
    } else {
        KeyDelivery::SoleWindow
    }
}

/// Prepares background keyboard delivery for `window`, or refuses it. Both
/// deliveries take the sole-window rule until the priming procedure lands.
pub(super) fn prepare_keys(
    window: &DesktopWindow,
    pid: libc::pid_t,
    wid: u32,
    capture: &MacCapture,
) -> CoreResult<()> {
    match key_delivery() {
        KeyDelivery::SoleWindow | KeyDelivery::Primed => sole_window_keys(window, pid, wid, capture),
    }
}

/// The sole-window rule for background keys.
///
/// macOS posts key events to a *process*, which hands them to whichever window
/// it treats as key; unlike pointer events they carry no window id. Delivery is
/// refused whenever the process owns more than one window, rather than typing
/// into another of the user's windows. `DesktopWindow::focused` cannot
/// disambiguate: xcap reports every window owned by the active application as
/// focused on macOS.
fn sole_window_keys(
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

#[cfg(test)]
mod key_session_tests {
    use super::*;

    #[test]
    fn only_priming_on_in_an_object_session_selects_the_primed_delivery() {
        let cases = [
            (KeyPriming::Off, ReportMode::Null, KeyDelivery::SoleWindow),
            (KeyPriming::Off, ReportMode::Object, KeyDelivery::SoleWindow),
            (KeyPriming::On, ReportMode::Null, KeyDelivery::SoleWindow),
            (KeyPriming::On, ReportMode::Object, KeyDelivery::Primed),
        ];
        for (priming, report_mode, expected) in cases {
            set_key_priming(priming);
            set_key_report_mode(report_mode);
            assert_eq!(key_delivery(), expected, "{priming:?} {report_mode:?}");
        }
    }
}
