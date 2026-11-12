//! Item 35 (design lane ruling; SP-N #13145@e32a295a17:n-elevated-printwindow CONTRADICTS):
//! `PrintWindow` into an elevated window returns a null frame, so for an `elevated:true` target
//! the floor never runs, WGC is the only window route, and a WGC that cannot serve it answers
//! `CaptureUnavailable{elevated_target}` before any `PrintWindow` call.

use omo_computer_core::backend::Backend;
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::{DispositionRule, EngineCode, NextCall, Reason};
use omo_computer_core::report::Disposition;

use super::kit::{rect, solid, window_os, window_target, ScriptedOs, OPTIONS};
use crate::Win32Backend;

fn elevated(wgc: bool) -> ScriptedOs {
    let mut os = window_os(wgc);
    if let Some(window) = os.window.as_mut() {
        window.elevated = true;
    }
    os
}

fn count(os: &ScriptedOs, call: &str) -> usize {
    os.calls.iter().filter(|seen| **seen == call).count()
}

#[test]
fn elevated_target_never_reaches_printwindow() {
    // WGC unsupported: the floor that serves an ordinary window is not tried.
    let mut backend = Win32Backend::with_os(elevated(false));
    let refusal = backend
        .capture(&window_target(), &OPTIONS)
        .expect_err("elevated");
    assert_eq!(refusal.code, EngineCode::CaptureUnavailable);
    assert_eq!(refusal.reason, Some(Reason::ElevatedTarget.wire()));
    assert_eq!(count(backend.os(), "print_window"), 0);

    // WGC has no item for it: refused the same way, still no PrintWindow.
    let mut backend = Win32Backend::with_os(elevated(true));
    let refusal = backend
        .capture(&window_target(), &OPTIONS)
        .expect_err("elevated");
    assert_eq!(refusal.reason, Some(Reason::ElevatedTarget.wire()));
    assert_eq!(count(backend.os(), "print_window"), 0);

    // WGC serves it: an ordinary WGC frame.
    let mut os = elevated(true);
    os.wgc_window = Some(Ok(solid(
        rect(100, 100, 400, 300),
        [0x10, 0x80, 0xF0, 0xFF],
    )));
    let mut backend = Win32Backend::with_os(os);
    let record = backend
        .capture_record(&window_target(), &OPTIONS)
        .expect("wgc frame");
    assert_eq!(record.route, CaptureRoute::Wgc);
}

#[test]
fn elevated_blank_wgc_frame_retries_wgc_never_printwindow() {
    let mut os = elevated(true);
    os.wgc_window = Some(Ok(solid(rect(100, 100, 400, 300), [0, 0, 0, 0])));
    let mut backend = Win32Backend::with_os(os);
    let refusal = backend
        .capture(&window_target(), &OPTIONS)
        .expect_err("still blank");
    assert_eq!(refusal.reason, Some(Reason::ElevatedTarget.wire()));
    assert_eq!(
        count(backend.os(), "wgc_window"),
        2,
        "the one retry is a second WGC frame"
    );
    assert_eq!(count(backend.os(), "print_window"), 0);
}

#[test]
fn elevated_target_refusal_is_after_user_with_no_next_call() {
    let mut backend = Win32Backend::with_os(elevated(false));
    let refusal = backend
        .capture(&window_target(), &OPTIONS)
        .expect_err("elevated");
    let row = refusal
        .row()
        .expect("CaptureUnavailable{elevated_target} has its own table row");
    assert_eq!(
        row.key.reason,
        Some(Reason::ElevatedTarget),
        "its own row, not the bare one"
    );
    assert_eq!(
        row.disposition,
        DispositionRule::Fixed(Disposition::NOT_DELIVERED_AFTER_USER)
    );
    assert!(
        matches!(row.next_call, NextCall::Nothing { .. }),
        "no next call"
    );
}

#[test]
fn window_capture_and_route_stay_the_hands_values_with_an_elevated_window() {
    // The pin has no per-window windowCapture: WindowInfo.elevated is the per-window datum, and
    // the hand's windowCapture and capture_route do not change because one window is elevated.
    let backend = Win32Backend::with_os(elevated(true));
    let capabilities = backend.capabilities();
    assert!(capabilities.window_capture.available);
    assert_eq!(capabilities.capture.route, Some(CaptureRoute::Wgc));
}
