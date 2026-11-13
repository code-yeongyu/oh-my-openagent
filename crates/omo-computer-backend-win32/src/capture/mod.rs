//! Windows capture (d-windows.md '## Capture'): `Windows.Graphics.Capture` when
//! `IsSupported` (read once per backend, i.e. per session open), the GDI
//! `PrintWindow(PW_RENDERFULLCONTENT)` floor cropped to `DWMWA_EXTENDED_FRAME_BOUNDS` inset
//! 1 px with the near-black oracle, and `BitBlt` per display as the display floor. All pixels
//! are physical. The OS calls sit behind [`CaptureOs`] so the route ladder is tested on
//! every OS; [`os::Os`] is the Windows implementation.
//!
//! Measured inputs (spike ledger SP-N #13145@e0e08a126e): `n-wgc-issupported-session0`
//! (Session 0 reads `IsSupported` false), `n-wgc-issupported-interactive`,
//! `n-capture-wgc-monitor-active`, `n-capture-wgc-window-active`,
//! `n-capture-printwindow-active` (the near-black oracle classifies live frames as frames),
//! `n-capture-*-display-off` (a display-off console still yields frames, so capture proceeds).
//! Locked-session capture is UNMEASURED.

mod display;
mod pixels;
mod session;
mod window;

#[cfg(windows)]
mod gdi;
#[cfg(windows)]
mod integrity;
#[cfg(all(test, windows))]
mod live_tests;
#[cfg(windows)]
pub(crate) mod os;
#[cfg(test)]
mod tests;
#[cfg(windows)]
mod wgc;

pub use session::SessionCondition;

pub use pixels::{
    composite, crop, draw_crosshair, encode_png, is_blank, is_near_black, NEAR_BLACK_CHANNEL_MAX,
    NEAR_BLACK_FRACTION, NEAR_BLACK_STRIDE,
};

use omo_computer_core::backend::{CaptureOptions, Refusal, Target};
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::{EngineCode, Reason};

use crate::displays::{Monitor, PhysRect};
use crate::ocr::OcrProbe;

/// The pixels of one capture: BGRA rows, and the virtual-screen rectangle they cover.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawFrame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
    pub origin: PhysRect,
}

/// What capture needs to know of a window before choosing a route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowFacts {
    /// `IsIconic`.
    pub iconic: bool,
    /// `DWMWA_CLOAKED` non-zero (another virtual desktop, or shell-cloaked).
    pub cloaked: bool,
    /// `DWMWA_EXTENDED_FRAME_BOUNDS`.
    pub frame_bounds: PhysRect,
    /// The owning process runs above the engine's integrity level, or refuses
    /// `PROCESS_QUERY_LIMITED_INFORMATION` (d-windows.md:303).
    pub elevated: bool,
}

/// Why an OS capture call produced no frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureFault {
    /// The WGC item could not be created for this target (cloaked, destroyed, unsupported).
    ItemUnavailable,
    /// The call answered with no image.
    NullFrame,
    /// No frame arrived before the per-frame deadline.
    Timeout,
}

/// The Windows calls capture makes. Implemented by [`os::Os`] on Windows and by scripted
/// fakes in tests.
pub trait CaptureOs: Send {
    /// `ProcessIdToSessionId` of the engine; Session 0 has no interactive desktop.
    fn session_id(&self) -> u32;
    /// `GraphicsCaptureSession::IsSupported()`.
    fn wgc_supported(&mut self) -> bool;
    /// The session facts of [`SessionCondition`]; the real OS reads unknown until row 60.
    fn session(&mut self) -> SessionCondition;
    /// # Errors
    /// The monitors cannot be enumerated.
    fn monitors(&mut self) -> Result<Vec<Monitor>, Refusal>;
    /// The window behind `hwnd`, or `None` when it does not exist.
    fn window(&mut self, hwnd: isize) -> Option<WindowFacts>;
    /// # Errors
    /// A [`CaptureFault`] when WGC yields no frame.
    fn wgc_window(&mut self, hwnd: isize, cursor: bool) -> Result<RawFrame, CaptureFault>;
    /// # Errors
    /// A [`CaptureFault`] when WGC yields no frame.
    fn wgc_monitor(&mut self, monitor: &Monitor, cursor: bool) -> Result<RawFrame, CaptureFault>;
    /// The whole window rect through `PrintWindow(PW_RENDERFULLCONTENT)`.
    ///
    /// # Errors
    /// A [`CaptureFault`] when GDI yields no image.
    fn print_window(&mut self, hwnd: isize, cursor: bool) -> Result<RawFrame, CaptureFault>;
    /// # Errors
    /// A [`CaptureFault`] when GDI yields no image.
    fn bitblt_monitor(&mut self, monitor: &Monitor, cursor: bool)
        -> Result<RawFrame, CaptureFault>;
    /// The OCR engine probe; never prompts.
    fn ocr_probe(&mut self) -> OcrProbe;
    /// The text lines of `frame`, boxes in the frame's pixels; `None` when the engine failed.
    fn recognize(
        &mut self,
        frame: &RawFrame,
    ) -> Option<Vec<omo_computer_core::observation::OcrLine>>;
}

/// One capture with the facts the frame record carries.
#[derive(Debug, Clone, PartialEq)]
pub struct FrameRecord {
    pub route: CaptureRoute,
    /// The virtual-screen rectangle the pixels cover, physical.
    pub physical: PhysRect,
    /// The scale of the monitor the frame is on (the first shown display for a composite).
    pub scale: f64,
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
    /// Displays left out of a composite over `MAX_COMPOSITE_PIXELS`.
    pub dropped: Vec<String>,
}

/// The engine runs in Session 0 (a service): nothing is captured and the session is named
/// (`PermissionDenied{session:not_interactive}`, d-windows.md:394 and :477).
pub const SESSION0: Refusal =
    Refusal::new(EngineCode::PermissionDenied, Reason::NotInteractive.wire());

pub(super) const fn failed(reason: Reason) -> Refusal {
    Refusal::new(EngineCode::CaptureFailed, reason.wire())
}

/// An elevated window WGC cannot serve: `PrintWindow` into it returns a null frame
/// (SP-N #13145@e32a295a17:n-elevated-printwindow, CONTRADICTS), so the floor never runs for it.
pub const ELEVATED: Refusal = Refusal::new(
    EngineCode::CaptureUnavailable,
    Reason::ElevatedTarget.wire(),
);

pub(super) const fn unavailable(reason: Reason) -> Refusal {
    Refusal::new(EngineCode::CaptureUnavailable, reason.wire())
}

/// The wire id of a window: its `HWND` in decimal.
#[must_use]
pub fn parse_window_id(id: &str) -> Option<isize> {
    id.parse().ok()
}

pub(super) fn from_fault(fault: CaptureFault) -> Refusal {
    match fault {
        CaptureFault::Timeout => failed(Reason::Timeout),
        CaptureFault::NullFrame | CaptureFault::ItemUnavailable => failed(Reason::NullFrame),
    }
}

/// Captures `target` with `wgc` the session's `IsSupported` read.
///
/// # Errors
/// `PermissionDenied{not_interactive}` in Session 0; `WindowNotFound`; `InvalidTarget` for an
/// unknown display; `CaptureUnavailable{minimized|other_desktop}`;
/// `CaptureFailed{black_frame|null_frame|timeout}`.
pub fn capture<O: CaptureOs + ?Sized>(
    os: &mut O,
    wgc: bool,
    target: &Target,
    options: &CaptureOptions,
) -> Result<FrameRecord, Refusal> {
    if os.session_id() == 0 {
        return Err(SESSION0);
    }
    let monitors = os.monitors()?;
    let mut record = match target {
        Target::Window(id) => window::capture(os, wgc, id, options.cursor, &monitors)?,
        Target::Display(id) => {
            let monitor = monitors
                .iter()
                .find(|monitor| monitor.device_name == *id)
                .ok_or(Refusal::bare(EngineCode::InvalidTarget))?;
            display::capture(os, wgc, std::slice::from_ref(monitor), options.cursor)?
        }
        Target::Desktop => display::capture(os, wgc, &monitors, options.cursor)?,
    };
    if let Some(region) = options.region {
        record = crop_record(record, region)?;
    }
    if let Some(at) = options.crosshair {
        draw_crosshair(&mut record.bgra, record.width, record.height, at.x, at.y);
    }
    Ok(record)
}

pub(super) fn record(route: CaptureRoute, frame: RawFrame, scale: f64) -> FrameRecord {
    FrameRecord {
        route,
        physical: frame.origin,
        scale,
        width: frame.width,
        height: frame.height,
        bgra: frame.bgra,
        dropped: Vec::new(),
    }
}

fn crop_record(
    record: FrameRecord,
    region: omo_computer_core::listing::Rect,
) -> Result<FrameRecord, Refusal> {
    // The region is in the frame's own pixels, as every frame-space coordinate is.
    #[allow(clippy::cast_possible_truncation)]
    let area = PhysRect {
        x: record.physical.x + region.x.round() as i32,
        y: record.physical.y + region.y.round() as i32,
        width: region.width.round() as i32,
        height: region.height.round() as i32,
    };
    let frame = RawFrame {
        width: record.width,
        height: record.height,
        bgra: record.bgra,
        origin: record.physical,
    };
    let frame = crop(&frame, &area).ok_or(Refusal::new(
        EngineCode::InvalidTarget,
        Reason::NoRegion.wire(),
    ))?;
    Ok(FrameRecord {
        physical: frame.origin,
        width: frame.width,
        height: frame.height,
        bgra: frame.bgra,
        ..record
    })
}
