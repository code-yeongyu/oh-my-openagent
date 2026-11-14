//! A scripted Windows: one 150 % monitor, one window, and per-route answers.

use omo_computer_core::backend::{CaptureOptions, Target};

use crate::capture::{CaptureFault, CaptureOs, RawFrame, SessionCondition, WindowFacts};
use crate::displays::{Monitor, PhysRect};
use crate::ocr::OcrProbe;

/// A scripted Windows: one 150 % monitor, one window, and per-route answers.
#[derive(Default)]
pub(super) struct ScriptedOs {
    pub(super) session_id: u32,
    pub(super) wgc: bool,
    pub(super) monitors: Vec<Monitor>,
    pub(super) window: Option<WindowFacts>,
    pub(super) wgc_window: Option<Result<RawFrame, CaptureFault>>,
    pub(super) print_window: Option<Result<RawFrame, CaptureFault>>,
    /// The session facts the seam answers (unknown unless a test scripts them).
    pub(super) session: SessionCondition,
    /// The colour every display route paints, or the default mid-blue.
    pub(super) monitor_bgra: Option<[u8; 4]>,
    pub(super) calls: Vec<&'static str>,
}

pub(super) const HWND: isize = 0x0002_0A3C;

pub(super) fn rect(x: i32, y: i32, width: i32, height: i32) -> PhysRect {
    PhysRect {
        x,
        y,
        width,
        height,
    }
}

pub(super) fn solid(origin: PhysRect, bgra: [u8; 4]) -> RawFrame {
    let count = usize::try_from(origin.width * origin.height).unwrap_or(0);
    RawFrame {
        width: u32::try_from(origin.width).unwrap_or(0),
        height: u32::try_from(origin.height).unwrap_or(0),
        bgra: bgra.repeat(count),
        origin,
    }
}

/// `frame` with the screen rows `rows` painted white.
pub(super) fn bright_rows(mut frame: RawFrame, rows: std::ops::Range<i32>) -> RawFrame {
    let stride = usize::try_from(frame.width).unwrap_or(0) * 4;
    for y in rows {
        let start = usize::try_from(y - frame.origin.y).unwrap_or(0) * stride;
        frame.bgra[start..start + stride].fill(0xFF);
    }
    frame
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
    fn session(&mut self) -> SessionCondition {
        self.calls.push("session");
        self.session
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
        self.wgc_window
            .clone()
            .unwrap_or(Err(CaptureFault::ItemUnavailable))
    }
    fn wgc_monitor(&mut self, monitor: &Monitor, _cursor: bool) -> Result<RawFrame, CaptureFault> {
        self.calls.push("wgc_monitor");
        Ok(solid(
            monitor.bounds,
            self.monitor_bgra.unwrap_or([0x30, 0x60, 0x90, 0xFF]),
        ))
    }
    fn print_window(&mut self, _hwnd: isize, _cursor: bool) -> Result<RawFrame, CaptureFault> {
        self.calls.push("print_window");
        self.print_window
            .clone()
            .unwrap_or(Err(CaptureFault::NullFrame))
    }
    fn bitblt_monitor(
        &mut self,
        monitor: &Monitor,
        _cursor: bool,
    ) -> Result<RawFrame, CaptureFault> {
        self.calls.push("bitblt_monitor");
        Ok(solid(
            monitor.bounds,
            self.monitor_bgra.unwrap_or([0x30, 0x60, 0x90, 0xFF]),
        ))
    }
    fn ocr_probe(&mut self) -> OcrProbe {
        OcrProbe::unavailable("no_language_pack")
    }
    fn recognize(
        &mut self,
        _frame: &RawFrame,
    ) -> Option<Vec<omo_computer_core::observation::OcrLine>> {
        self.calls.push("recognize");
        None
    }
}

pub(super) fn window_os(wgc: bool) -> ScriptedOs {
    let frame = rect(100, 100, 400, 300);
    ScriptedOs {
        session_id: 2,
        wgc,
        monitors: vec![monitor_150()],
        window: Some(WindowFacts {
            iconic: false,
            cloaked: false,
            elevated: false,
            frame_bounds: frame,
        }),
        // PrintWindow renders the whole window rect, a little larger than the DWM frame bounds.
        print_window: Some(Ok(solid(rect(92, 100, 416, 308), [0xE0, 0xE0, 0xE0, 0xFF]))),
        ..ScriptedOs::default()
    }
}

pub(super) const OPTIONS: CaptureOptions = CaptureOptions {
    cursor: true,
    crosshair: None,
    region: None,
};

pub(super) fn window_target() -> Target {
    Target::Window(HWND.to_string())
}
