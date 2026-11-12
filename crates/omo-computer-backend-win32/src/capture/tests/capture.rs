//! The capture route ladder, the near-black oracle, per-monitor-v2 scale and the route tokens.

use omo_computer_core::backend::{Backend, Target};
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::{EngineCode, Reason};

use super::kit::{bright_rows, rect, solid, window_os, window_target, OPTIONS};
use crate::capture::CaptureFault;
use crate::Win32Backend;

#[test]
fn wgc_unsupported_falls_to_printwindow() {
    let mut backend = Win32Backend::with_os(window_os(false));
    let record = backend
        .capture_record(&window_target(), &OPTIONS)
        .expect("floor frame");
    assert_eq!(record.route, CaptureRoute::PrintWindow);
    // Cropped to DWMWA_EXTENDED_FRAME_BOUNDS inset 1 px.
    assert_eq!((record.width, record.height), (398, 298));
    assert!(
        !backend.os().calls.contains(&"wgc_window"),
        "IsSupported false never asks WGC"
    );
    assert_eq!(
        backend
            .os()
            .calls
            .iter()
            .filter(|c| **c == "wgc_supported")
            .count(),
        1
    );
    assert_eq!(
        backend.capabilities().capture.route,
        Some(CaptureRoute::PrintWindow)
    );

    // WGC supported but the item cannot be created: the same floor, once.
    let mut backend = Win32Backend::with_os(window_os(true));
    let record = backend
        .capture_record(&window_target(), &OPTIONS)
        .expect("floor frame");
    assert_eq!(record.route, CaptureRoute::PrintWindow);
    assert_eq!(
        backend
            .os()
            .calls
            .iter()
            .filter(|c| **c == "print_window")
            .count(),
        1
    );

    // WGC answers a fully transparent frame: the floor runs once.
    let mut os = window_os(true);
    os.wgc_window = Some(Ok(solid(rect(100, 100, 400, 300), [0, 0, 0, 0])));
    let mut backend = Win32Backend::with_os(os);
    let record = backend
        .capture_record(&window_target(), &OPTIONS)
        .expect("floor frame");
    assert_eq!(record.route, CaptureRoute::PrintWindow);

    // A real WGC frame is the primary path.
    let mut os = window_os(true);
    os.wgc_window = Some(Ok(solid(
        rect(100, 100, 400, 300),
        [0x10, 0x80, 0xF0, 0xFF],
    )));
    let mut backend = Win32Backend::with_os(os);
    let record = backend
        .capture_record(&window_target(), &OPTIONS)
        .expect("wgc frame");
    assert_eq!(record.route, CaptureRoute::Wgc);
    assert!(!backend.os().calls.contains(&"print_window"));
}

#[test]
fn near_black_printwindow_frame_is_rejected() {
    let mut os = window_os(false);
    // One bright row of the 298 the crop keeps: over 99 % near black (every channel <= 16) is
    // still a black frame.
    os.print_window = Some(Ok(bright_rows(
        solid(rect(92, 100, 416, 308), [0x10, 0x08, 0x00, 0xFF]),
        200..201,
    )));
    let mut backend = Win32Backend::with_os(os);
    let refusal = backend
        .capture(&window_target(), &OPTIONS)
        .expect_err("black frame");
    assert_eq!(refusal.code, EngineCode::CaptureFailed);
    assert_eq!(refusal.reason, Some(Reason::BlackFrame.wire()));

    // Sixty bright rows of 298: about 80 % near black is a frame (a dark UI is not a failure).
    let mut os = window_os(false);
    os.print_window = Some(Ok(bright_rows(
        solid(rect(92, 100, 416, 308), [0x00, 0x00, 0x00, 0xFF]),
        101..161,
    )));
    let mut backend = Win32Backend::with_os(os);
    assert!(backend.capture(&window_target(), &OPTIONS).is_ok());

    // No pixels at all is the null-image half.
    let mut os = window_os(false);
    os.print_window = Some(Err(CaptureFault::NullFrame));
    let mut backend = Win32Backend::with_os(os);
    let refusal = backend
        .capture(&window_target(), &OPTIONS)
        .expect_err("null frame");
    assert_eq!(refusal.reason, Some(Reason::NullFrame.wire()));
}

#[test]
fn per_monitor_v2_scale_in_frame_record() {
    let mut backend = Win32Backend::with_os(window_os(true));
    let displays = backend.displays().expect("displays");
    assert_eq!(displays.len(), 1);
    assert!(
        (displays[0].scale - 1.5).abs() < f64::EPSILON,
        "144 dpi is 150 %"
    );
    // Physical pixels end to end: the bounds are the monitor's device pixels, never logical.
    assert!((displays[0].bounds.width - 3840.0).abs() < f64::EPSILON);
    assert_eq!(displays[0].id, r"\\.\DISPLAY1");

    let record = backend
        .capture_record(&Target::Display(displays[0].id.clone()), &OPTIONS)
        .expect("display frame");
    assert_eq!(record.route, CaptureRoute::Wgc);
    assert!((record.scale - 1.5).abs() < f64::EPSILON);
    assert_eq!((record.width, record.height), (3840, 2160));

    // A window on the 150 % monitor carries that monitor's scale in its record.
    let mut os = window_os(true);
    os.wgc_window = Some(Ok(solid(
        rect(100, 100, 400, 300),
        [0x10, 0x80, 0xF0, 0xFF],
    )));
    let mut backend = Win32Backend::with_os(os);
    let record = backend
        .capture_record(&window_target(), &OPTIONS)
        .expect("wgc frame");
    assert!((record.scale - 1.5).abs() < f64::EPSILON);

    // Session 0 has no interactive desktop: nothing is captured and the session is named.
    let mut os = window_os(true);
    os.session_id = 0;
    let mut backend = Win32Backend::with_os(os);
    let refusal = backend
        .capture(&window_target(), &OPTIONS)
        .expect_err("session 0");
    assert_eq!(refusal.code, EngineCode::PermissionDenied);
    assert_eq!(refusal.reason, Some(Reason::NotInteractive.wire()));
    assert!(!backend
        .os()
        .calls
        .iter()
        .any(|call| call.starts_with("wgc_") || *call == "print_window"));
}

#[test]
fn capture_route_wire_tokens_are_the_designs() {
    // d-windows.md:87: capture_route "wgc" | "printwindow" | "bitblt".
    for (route, wire) in [
        (CaptureRoute::Wgc, "\"wgc\""),
        (CaptureRoute::PrintWindow, "\"printwindow\""),
        (CaptureRoute::BitBlt, "\"bitblt\""),
    ] {
        assert_eq!(serde_json::to_string(&route).expect("serialize"), wire);
        assert_eq!(
            serde_json::from_str::<CaptureRoute>(wire).expect("parse"),
            route
        );
    }
}
