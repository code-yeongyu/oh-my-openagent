//! Row 55's session sentence (d-windows.md:383; ruling R70d(2)): a null or near-black DISPLAY or
//! WINDOW frame while the session is known inactive or the display known asleep is the existing
//! CaptureFailed{null_frame|black_frame}; under unknown, and with an active session and an awake
//! display, a dark desktop or window stays a frame. The reply half (the session stamp and
//! nextCall ask_user) is an owed leg of row 60 (DEFERRED-LEGS).

use omo_computer_core::backend::Target;
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::session_state::Tristate;

use super::kit::{rect, solid, window_os, window_target, ScriptedOs, OPTIONS};
use crate::capture::SessionCondition;
use crate::Win32Backend;

const DARK: [u8; 4] = [0x02, 0x02, 0x02, 0xFF];

fn display_os(wgc: bool, session: SessionCondition, bgra: [u8; 4]) -> ScriptedOs {
    ScriptedOs {
        session,
        monitor_bgra: Some(bgra),
        ..window_os(wgc)
    }
}

const INACTIVE: SessionCondition = SessionCondition {
    session_active: Tristate::Known(false),
    ..SessionCondition::UNKNOWN
};
const ASLEEP: SessionCondition = SessionCondition {
    display_asleep: Tristate::Known(true),
    ..SessionCondition::UNKNOWN
};
const LIVE: SessionCondition = SessionCondition {
    session_active: Tristate::Known(true),
    display_asleep: Tristate::Known(false),
};

fn black_frame(os: ScriptedOs, target: &Target) {
    let mut backend = Win32Backend::with_os(os);
    let refusal = backend
        .capture_record(target, &OPTIONS)
        .expect_err("a near-black display frame under the session cause is refused");
    assert_eq!(refusal.code, EngineCode::CaptureFailed);
    assert_eq!(refusal.reason, Some(Reason::BlackFrame.wire()));
}

#[test]
fn near_black_display_frame_while_session_inactive_is_black_frame() {
    black_frame(display_os(true, INACTIVE, DARK), &Target::Desktop);
    black_frame(display_os(false, INACTIVE, DARK), &Target::Desktop);
    black_frame(
        display_os(true, INACTIVE, DARK),
        &Target::Display(r"\\.\DISPLAY1".to_owned()),
    );
}

#[test]
fn near_black_display_frame_while_display_asleep_is_black_frame() {
    black_frame(display_os(true, ASLEEP, DARK), &Target::Desktop);
    black_frame(display_os(false, ASLEEP, DARK), &Target::Desktop);
}

#[test]
fn dark_desktop_stays_a_frame_when_the_session_is_unknown_or_live() {
    for (session, wgc, route) in [
        (SessionCondition::UNKNOWN, true, CaptureRoute::Wgc),
        (SessionCondition::UNKNOWN, false, CaptureRoute::BitBlt),
        (LIVE, true, CaptureRoute::Wgc),
    ] {
        let mut backend = Win32Backend::with_os(display_os(wgc, session, DARK));
        let record = backend
            .capture_record(&Target::Desktop, &OPTIONS)
            .expect("a dark desktop is a frame without the session cause");
        assert_eq!(record.route, route);
    }
}

#[test]
fn a_bright_display_frame_under_the_session_cause_is_a_frame() {
    let mut backend = Win32Backend::with_os(display_os(true, INACTIVE, [0x30, 0x60, 0x90, 0xFF]));
    assert!(backend.capture_record(&Target::Desktop, &OPTIONS).is_ok());
}

#[test]
fn the_seam_is_read_once_per_capture() {
    let mut backend = Win32Backend::with_os(display_os(true, INACTIVE, DARK));
    let _ = backend.capture_record(&Target::Desktop, &OPTIONS);
    let reads = backend
        .os()
        .calls
        .iter()
        .filter(|c| **c == "session")
        .count();
    assert_eq!(reads, 1);
    let mut backend = Win32Backend::with_os(dark_window_os(INACTIVE, false));
    let _ = backend.capture_record(&window_target(), &OPTIONS);
    let reads = backend
        .os()
        .calls
        .iter()
        .filter(|c| **c == "session")
        .count();
    assert_eq!(reads, 1);
}

/// A window whose WGC frame is near black but not blank (so the blank-frame floor does not run).
fn dark_window_os(session: SessionCondition, elevated: bool) -> ScriptedOs {
    let mut os = window_os(true);
    os.session = session;
    os.wgc_window = Some(Ok(solid(rect(100, 100, 400, 300), DARK)));
    if let Some(facts) = os.window.as_mut() {
        facts.elevated = elevated;
    }
    os
}

#[test]
fn near_black_window_frame_under_the_session_cause_is_black_frame() {
    for (session, elevated) in [
        (INACTIVE, false),
        (ASLEEP, false),
        (INACTIVE, true),
        (ASLEEP, true),
    ] {
        black_frame(dark_window_os(session, elevated), &window_target());
    }
}

#[test]
fn null_window_frame_under_the_session_cause_is_null_frame() {
    let mut os = window_os(true);
    os.session = INACTIVE;
    os.wgc_window = Some(Err(crate::capture::CaptureFault::NullFrame));
    os.print_window = Some(Err(crate::capture::CaptureFault::NullFrame));
    let mut backend = Win32Backend::with_os(os);
    let refusal = backend
        .capture_record(&window_target(), &OPTIONS)
        .expect_err("a null window frame is refused");
    assert_eq!(refusal.code, EngineCode::CaptureFailed);
    assert_eq!(refusal.reason, Some(Reason::NullFrame.wire()));
}

#[test]
fn dark_window_stays_a_frame_when_the_session_is_unknown_or_live() {
    for (session, elevated) in [
        (SessionCondition::UNKNOWN, false),
        (LIVE, false),
        (SessionCondition::UNKNOWN, true),
    ] {
        let mut backend = Win32Backend::with_os(dark_window_os(session, elevated));
        let record = backend
            .capture_record(&window_target(), &OPTIONS)
            .expect("a dark window is a frame without the session cause");
        assert_eq!(record.route, CaptureRoute::Wgc);
    }
}

#[test]
fn unknown_never_fires_the_session_cause() {
    assert!(!SessionCondition::UNKNOWN.is_dark());
    assert!(!SessionCondition::default().is_dark());
    assert!(!LIVE.is_dark());
    assert!(INACTIVE.is_dark());
    assert!(ASLEEP.is_dark());
}
