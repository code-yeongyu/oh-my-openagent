//! Live checks for a Wayland session that has no RemoteDesktop or
//! GlobalShortcuts portal backend (gorky: `sway --headless` under
//! `dbus-run-session`, no `LIBEI_SOCKET`). `#[ignore]`d; run with
//! `--ignored live_ --nocapture`. The QA script proves the absence of the
//! portals with an independent `dbus-send ListNames` probe; each test prints
//! machine-read `key=value` facts for the evidence.

use std::sync::Arc;

use senpi_desktop_core::backend::{Backend, DeliveryMode};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::{CaptureCaps, DisplaySelector, Target};
use senpi_desktop_safety::{Chord, MonotonicClock, StopPathListener, Supervisor};

use crate::capture::screenshot_portal::UNAVAILABLE as CAPTURE_UNAVAILABLE;
use crate::portal::remote_desktop::INPUT_PATH_REQUIRED;
use crate::{GlobalShortcutsListener, WaylandBackend, STOP_PATH_UNAVAILABLE};

fn preconditions() {
    assert!(
        std::env::var_os("WAYLAND_DISPLAY").is_some(),
        "precondition: a Wayland session"
    );
    assert!(
        std::env::var_os("LIBEI_SOCKET").is_none(),
        "precondition: no LIBEI_SOCKET"
    );
}

#[test]
#[ignore = "live: needs a Wayland session without portals"]
fn live_session_without_portals_reports_input_unavailable() {
    preconditions();
    let mut backend = WaylandBackend::new(DisplaySelector::All);

    let caps = backend.capabilities();

    println!(
        "backend={} input={} input_permission={} delivery_modes={:?} background_window_input={} capture={} ax_permission={}",
        caps.backend,
        caps.input,
        caps.input_permission,
        caps.delivery_modes,
        caps.background_window_input,
        caps.capture,
        caps.ax_permission
    );
    assert_eq!(caps.input_permission, "unavailable");
    assert!(!caps.input);
    assert_eq!(caps.delivery_modes, ["background"]);
}

#[test]
#[ignore = "live: needs a Wayland session without portals"]
fn live_session_without_portals_refuses_input_with_the_path_message() {
    preconditions();
    let mut backend = WaylandBackend::new(DisplaySelector::All);

    let typed = backend.type_text(&Target::Desktop, "hello", DeliveryMode::Background);

    let error = typed.expect_err("no input path exists");
    println!("type_text_error={error}");
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(error.message.starts_with(INPUT_PATH_REQUIRED));
}

#[test]
#[ignore = "live: needs a Wayland session without portals"]
fn live_session_without_portals_reports_capture_unavailable() {
    preconditions();
    let mut backend = WaylandBackend::new(DisplaySelector::All);

    let captured = backend.capture(&Target::Desktop, &CaptureCaps::default());
    let caps = backend.capabilities();

    let error = captured.expect_err("no Screenshot portal exists");
    println!(
        "capture_error={error} capture={} capture_permission={}",
        caps.capture, caps.capture_permission
    );
    assert_eq!(error.code, ErrorCode::CaptureFailed);
    assert!(error.message.starts_with(CAPTURE_UNAVAILABLE));
    assert!(!caps.capture);
    assert_eq!(caps.capture_permission, "unavailable");
}

#[test]
#[ignore = "live: needs a Wayland session without portals"]
fn live_session_without_portals_reports_global_shortcuts_unavailable() {
    preconditions();
    let supervisor = Arc::new(Supervisor::new(Arc::new(MonotonicClock::new())));
    let mut listener = GlobalShortcutsListener::new();

    let started = listener.start(
        &Chord::parse("ctrl+alt+shift+escape").expect("chord"),
        Arc::clone(&supervisor),
    );

    let reason = started.as_ref().err().map(|error| error.reason().to_owned());
    let status = supervisor.status();
    println!(
        "stop_path_reason={reason:?} global_live={} stop_path={}",
        status.global_live,
        status.stop_path.as_str()
    );
    assert_eq!(reason.as_deref(), Some(STOP_PATH_UNAVAILABLE));
    assert!(!status.global_live);
}
