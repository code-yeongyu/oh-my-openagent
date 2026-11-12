//! Row 55's RED tests: the capture route ladder, the near-black oracle, per-monitor-v2 scale
//! and OCR kept out of the default observe payload. They run on every OS through the
//! `CaptureOs` seam; the live legs run on the Windows leg with `--include-ignored`.

use omo_computer_core::backend::{Backend, CaptureOptions, Target};
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::ObserveOptions;

use crate::capture::{CaptureFault, CaptureOs, RawFrame, WindowFacts};
use crate::displays::{Monitor, PhysRect};
use crate::ocr::{decide, OcrProbe};
use crate::Win32Backend;

/// A scripted Windows: one 150 % monitor, one window, and per-route answers.
#[derive(Default)]
struct ScriptedOs {
    session_id: u32,
    wgc: bool,
    monitors: Vec<Monitor>,
    window: Option<WindowFacts>,
    wgc_window: Option<Result<RawFrame, CaptureFault>>,
    print_window: Option<Result<RawFrame, CaptureFault>>,
    calls: Vec<&'static str>,
}

const HWND: isize = 0x0002_0A3C;

fn rect(x: i32, y: i32, width: i32, height: i32) -> PhysRect {
    PhysRect { x, y, width, height }
}

fn solid(origin: PhysRect, bgra: [u8; 4]) -> RawFrame {
    let count = usize::try_from(origin.width * origin.height).unwrap_or(0);
    RawFrame {
        width: u32::try_from(origin.width).unwrap_or(0),
        height: u32::try_from(origin.height).unwrap_or(0),
        bgra: bgra.repeat(count),
        origin,
    }
}

fn monitor_150() -> Monitor {
    Monitor {
        device_name: r"\\.\DISPLAY1".to_owned(),
        handle: 0x10001,
        bounds: rect(0, 0, 3840, 2160),
        primary: true,
        dpi: 144,
    }
}

impl CaptureOs for ScriptedOs {
    fn session_id(&self) -> u32 {
        self.session_id
    }
    fn wgc_supported(&mut self) -> bool {
        self.calls.push("wgc_supported");
        self.wgc
    }
    fn monitors(&mut self) -> Result<Vec<Monitor>, omo_computer_core::backend::Refusal> {
        Ok(self.monitors.clone())
    }
    fn window(&mut self, hwnd: isize) -> Option<WindowFacts> {
        (hwnd == HWND).then_some(self.window).flatten()
    }
    fn wgc_window(&mut self, _hwnd: isize, _cursor: bool) -> Result<RawFrame, CaptureFault> {
        self.calls.push("wgc_window");
        self.wgc_window.clone().unwrap_or(Err(CaptureFault::ItemUnavailable))
    }
    fn wgc_monitor(&mut self, monitor: &Monitor, _cursor: bool) -> Result<RawFrame, CaptureFault> {
        self.calls.push("wgc_monitor");
        Ok(solid(monitor.bounds, [0x30, 0x60, 0x90, 0xFF]))
    }
    fn print_window(&mut self, _hwnd: isize, _cursor: bool) -> Result<RawFrame, CaptureFault> {
        self.calls.push("print_window");
        self.print_window.clone().unwrap_or(Err(CaptureFault::NullFrame))
    }
    fn bitblt_monitor(&mut self, monitor: &Monitor, _cursor: bool) -> Result<RawFrame, CaptureFault> {
        self.calls.push("bitblt_monitor");
        Ok(solid(monitor.bounds, [0x30, 0x60, 0x90, 0xFF]))
    }
    fn ocr_probe(&mut self) -> OcrProbe {
        OcrProbe::unavailable("no_language_pack")
    }
    fn recognize(&mut self, _frame: &RawFrame) -> Option<Vec<omo_computer_core::observation::OcrLine>> {
        self.calls.push("recognize");
        None
    }
}

fn window_os(wgc: bool) -> ScriptedOs {
    let frame = rect(100, 100, 400, 300);
    ScriptedOs {
        session_id: 2,
        wgc,
        monitors: vec![monitor_150()],
        window: Some(WindowFacts {
            iconic: false,
            cloaked: false,
            frame_bounds: frame,
        }),
        // PrintWindow renders the whole window rect, a little larger than the DWM frame bounds.
        print_window: Some(Ok(solid(rect(92, 100, 416, 308), [0xE0, 0xE0, 0xE0, 0xFF]))),
        ..ScriptedOs::default()
    }
}

const OPTIONS: CaptureOptions = CaptureOptions {
    cursor: true,
    crosshair: None,
    region: None,
};

fn window_target() -> Target {
    Target::Window(HWND.to_string())
}

#[test]
fn wgc_unsupported_falls_to_printwindow() {
    let mut backend = Win32Backend::with_os(window_os(false));
    let record = backend.capture_record(&window_target(), &OPTIONS).expect("floor frame");
    assert_eq!(record.route, CaptureRoute::PrintWindow);
    // Cropped to DWMWA_EXTENDED_FRAME_BOUNDS inset 1 px.
    assert_eq!((record.width, record.height), (398, 298));
    assert!(!backend.os().calls.contains(&"wgc_window"), "IsSupported false never asks WGC");
    assert_eq!(backend.os().calls.iter().filter(|c| **c == "wgc_supported").count(), 1);
    assert_eq!(backend.capabilities().capture.route, Some(CaptureRoute::PrintWindow));

    // WGC supported but the item cannot be created: the same floor, once.
    let mut backend = Win32Backend::with_os(window_os(true));
    let record = backend.capture_record(&window_target(), &OPTIONS).expect("floor frame");
    assert_eq!(record.route, CaptureRoute::PrintWindow);
    assert_eq!(backend.os().calls.iter().filter(|c| **c == "print_window").count(), 1);

    // WGC answers a fully transparent frame: the floor runs once.
    let mut os = window_os(true);
    os.wgc_window = Some(Ok(solid(rect(100, 100, 400, 300), [0, 0, 0, 0])));
    let mut backend = Win32Backend::with_os(os);
    let record = backend.capture_record(&window_target(), &OPTIONS).expect("floor frame");
    assert_eq!(record.route, CaptureRoute::PrintWindow);

    // A real WGC frame is the primary path.
    let mut os = window_os(true);
    os.wgc_window = Some(Ok(solid(rect(100, 100, 400, 300), [0x10, 0x80, 0xF0, 0xFF])));
    let mut backend = Win32Backend::with_os(os);
    let record = backend.capture_record(&window_target(), &OPTIONS).expect("wgc frame");
    assert_eq!(record.route, CaptureRoute::Wgc);
    assert!(!backend.os().calls.contains(&"print_window"));
}

#[test]
fn near_black_printwindow_frame_is_rejected() {
    let mut os = window_os(false);
    // 99 % near black (every channel <= 16), 1 % bright: still a black frame.
    let mut frame = solid(rect(92, 100, 416, 308), [0x10, 0x08, 0x00, 0xFF]);
    for pixel in frame.bgra.chunks_mut(4).step_by(100) {
        pixel.copy_from_slice(&[0xFF, 0xFF, 0xFF, 0xFF]);
    }
    os.print_window = Some(Ok(frame));
    let mut backend = Win32Backend::with_os(os);
    let refusal = backend.capture(&window_target(), &OPTIONS).expect_err("black frame");
    assert_eq!(refusal.code, EngineCode::CaptureFailed);
    assert_eq!(refusal.reason, Some(Reason::BlackFrame.wire()));

    // 90 % near black is a frame (a dark UI is not a failure).
    let mut os = window_os(false);
    let mut frame = solid(rect(92, 100, 416, 308), [0x00, 0x00, 0x00, 0xFF]);
    for pixel in frame.bgra.chunks_mut(4).step_by(10) {
        pixel.copy_from_slice(&[0xFF, 0xFF, 0xFF, 0xFF]);
    }
    os.print_window = Some(Ok(frame));
    let mut backend = Win32Backend::with_os(os);
    assert!(backend.capture(&window_target(), &OPTIONS).is_ok());

    // No pixels at all is the null-image half.
    let mut os = window_os(false);
    os.print_window = Some(Err(CaptureFault::NullFrame));
    let mut backend = Win32Backend::with_os(os);
    let refusal = backend.capture(&window_target(), &OPTIONS).expect_err("null frame");
    assert_eq!(refusal.reason, Some(Reason::NullFrame.wire()));
}

#[test]
fn per_monitor_v2_scale_in_frame_record() {
    let mut backend = Win32Backend::with_os(window_os(true));
    let displays = backend.displays().expect("displays");
    assert_eq!(displays.len(), 1);
    assert!((displays[0].scale - 1.5).abs() < f64::EPSILON, "144 dpi is 150 %");
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
    os.wgc_window = Some(Ok(solid(rect(100, 100, 400, 300), [0x10, 0x80, 0xF0, 0xFF])));
    let mut backend = Win32Backend::with_os(os);
    let record = backend.capture_record(&window_target(), &OPTIONS).expect("wgc frame");
    assert!((record.scale - 1.5).abs() < f64::EPSILON);

    // Session 0 has no interactive desktop: nothing is captured and the session is named.
    let mut os = window_os(true);
    os.session_id = 0;
    let mut backend = Win32Backend::with_os(os);
    let refusal = backend.capture(&window_target(), &OPTIONS).expect_err("session 0");
    assert_eq!(refusal.code, EngineCode::PermissionDenied);
    assert_eq!(refusal.reason, Some(Reason::NotInteractive.wire()));
    assert!(!backend.os().calls.iter().any(|call| call.starts_with("wgc_") || *call == "print_window"));
}

#[test]
fn ocr_absent_from_default_observe() {
    let defaults = ObserveOptions::default();
    // The default observe of a window with a tree never runs OCR, even with an engine present.
    assert!(!decide(defaults.ocr, true, 12, false, true));
    // A capability-less host never runs it, whatever is asked.
    assert!(!decide(Some(omo_computer_core::params::OcrMode::Always), false, 0, true, true));
    // Auto runs it only on an empty or AX-blind tree after the cooldown; Always on request.
    assert!(decide(defaults.ocr, true, 0, false, true));
    assert!(!decide(defaults.ocr, true, 0, false, false));
    assert!(decide(Some(omo_computer_core::params::OcrMode::Always), true, 12, false, false));
    assert!(!decide(Some(omo_computer_core::params::OcrMode::Never), true, 0, true, true));
    // The capability is the probe's answer, never asserted.
    let backend = Win32Backend::with_os(window_os(true));
    assert!(!backend.capabilities().ocr);
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
        assert_eq!(serde_json::from_str::<CaptureRoute>(wire).expect("parse"), route);
    }
}
