//! Background-delivery policy: the app guard and the sole-window keyboard
//! rule. Decisions only - no event posting happens here.

use std::cell::Cell;
use std::time::{Duration, Instant};

use senpi_desktop_core::backend::{MouseButton, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::report::ReportMode;
use senpi_desktop_core::types::{DesktopWindow, KeyPriming};

use super::priming;
use super::user_feed_raw::RawFeed;
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

/// Background keys for `window`: makes it the key window its process routes
/// keys to, or refuses with nothing sent, then runs `send`. `activated` is
/// set to `(pid, wid)` once key focus moved, for the session's hand-back.
///
/// A process with one window takes the sole-window path. A process with
/// several windows is refused, unless the session opted into priming
/// ([`KeyDelivery::Primed`]): then the target is primed and proven key
/// ([`super::priming`]) and key focus inside the app is handed back after
/// `send`, whatever it returned.
pub(super) fn deliver_keys<T>(
    window: &DesktopWindow,
    pid: libc::pid_t,
    wid: u32,
    capture: &MacCapture,
    feed: Option<&RawFeed>,
    activated: &mut Option<(libc::pid_t, u32)>,
    send: impl FnOnce() -> CoreResult<T>,
) -> CoreResult<T> {
    let siblings = siblings(window, capture)?;
    if siblings > 1 && key_delivery() == KeyDelivery::Primed {
        let mut ops = LiveOps { pid, wid, feed };
        let (result, moved) = priming::primed_delivery(wid, &mut ops, |_| {
            *activated = Some((pid, wid));
            send()
        });
        if moved.is_some() {
            *activated = Some((pid, wid));
        }
        return result;
    }
    sole_window_keys(wid, siblings)?;
    // Sole window of its process, so the target is unambiguous: make it key
    // without raising it or changing the frontmost application. A background app
    // otherwise has no key window and drops the keystrokes entirely.
    skylight::activate_without_raise(pid, wid)?;
    *activated = Some((pid, wid));
    send()
}

/// The sole-window rule alone, for held keys: makes the target key or
/// refuses a process with several windows.
pub(super) fn prepare_keys(
    window: &DesktopWindow,
    pid: libc::pid_t,
    wid: u32,
    capture: &MacCapture,
) -> CoreResult<()> {
    sole_window_keys(wid, siblings(window, capture)?)?;
    skylight::activate_without_raise(pid, wid)
}

/// The windows the capture lists for `window`'s process.
fn siblings(window: &DesktopWindow, capture: &MacCapture) -> CoreResult<usize> {
    Ok(capture.windows()?.into_iter().filter(|candidate| candidate.pid == window.pid).count())
}

/// Priming's reads and posts on the live desktop, for `(pid, wid)`.
struct LiveOps<'feed> {
    pid: libc::pid_t,
    wid: u32,
    feed: Option<&'feed RawFeed>,
}

impl LiveOps<'_> {
    fn window(&self, wid: u32) -> DesktopWindow {
        DesktopWindow {
            identity: None,
            id: wid.to_string(),
            title: String::new(),
            app: String::new(),
            pid: u32::try_from(self.pid).ok(),
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            focused: false,
            is_on_screen: None,
            elevated: None,
        }
    }
}

impl priming::PrimingOps for LiveOps<'_> {
    fn read(&mut self) -> priming::Read {
        let listed = crate::focus::window_info().map(|windows| {
            windows.iter().any(|window| {
                window.window_number == self.wid && libc::pid_t::try_from(window.pid) == Ok(self.pid)
            })
        });
        if listed == Ok(false) {
            return priming::Read::Gone;
        }
        match super::element::focus_read(self.pid, READ_TIMEOUT) {
            Some(read) => priming::Read::Focus(read),
            None => priming::Read::Unreadable,
        }
    }

    fn apply(&mut self, step: priming::Move) -> bool {
        match step {
            priming::Move::Short => skylight::post_key_records(self.pid, self.wid, false),
            priming::Move::Full => skylight::post_key_records(self.pid, self.wid, true),
            priming::Move::AxWrite => crate::ax::focus_key_window(&self.window(self.wid)).is_ok(),
        }
    }

    fn wait(&mut self, time: Duration) {
        std::thread::sleep(time);
    }

    fn user_active_in_target(&mut self) -> bool {
        self.target_app_front()
            && self.feed.is_some_and(|feed| feed.pressed_within(priming::TAKEOVER, Instant::now()))
    }

    fn target_app_front(&mut self) -> bool {
        crate::front_app::current_front_pid() == Some(self.pid)
    }

    fn window_order(&mut self) -> Vec<u32> {
        crate::focus::window_info()
            .unwrap_or_default()
            .iter()
            .filter(|window| libc::pid_t::try_from(window.pid) == Ok(self.pid) && window.layer == 0 && window.on_screen)
            .map(|window| window.window_number)
            .collect()
    }

    fn make_key(&mut self, window: u32) -> bool {
        crate::ax::focus_key_window(&self.window(window)).is_ok()
    }
}

/// The longest one priming focus read may wait for the application.
const READ_TIMEOUT: Duration = Duration::from_millis(250);

/// The sole-window rule for background keys.
///
/// macOS posts key events to a *process*, which hands them to whichever window
/// it treats as key; unlike pointer events they carry no window id. Delivery is
/// refused whenever the process owns more than one window, rather than typing
/// into another of the user's windows. `DesktopWindow::focused` cannot
/// disambiguate: xcap reports every window owned by the active application as
/// focused on macOS.
fn sole_window_keys(wid: u32, siblings: usize) -> CoreResult<()> {
    if siblings > 1 {
        return Err(DesktopError::background_unavailable(format!(
            "window {wid} is one of {siblings} windows in its application; macOS delivers \
             background keystrokes to whichever window the application treats as key, so retry \
             with delivery:\"foreground\" or use ax actions",
        )));
    }
    Ok(())
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
