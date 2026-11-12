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

mod pixels;

#[cfg(windows)]
mod gdi;
#[cfg(all(test, windows))]
mod live_tests;
#[cfg(windows)]
pub(crate) mod os;
#[cfg(windows)]
mod wgc;

pub use pixels::{
    composite, crop, draw_crosshair, encode_png, is_blank, is_near_black, NEAR_BLACK_CHANNEL_MAX,
    NEAR_BLACK_FRACTION, NEAR_BLACK_STRIDE,
};

use omo_computer_core::backend::{CaptureOptions, Refusal, Target};
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::frame::MAX_COMPOSITE_PIXELS;

use crate::displays::{monitor_for, Monitor, PhysRect};
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

const fn failed(reason: Reason) -> Refusal {
    Refusal::new(EngineCode::CaptureFailed, reason.wire())
}

const fn unavailable(reason: Reason) -> Refusal {
    Refusal::new(EngineCode::CaptureUnavailable, reason.wire())
}

/// The wire id of a window: its `HWND` in decimal.
#[must_use]
pub fn parse_window_id(id: &str) -> Option<isize> {
    id.parse().ok()
}

fn from_fault(fault: CaptureFault) -> Refusal {
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
        Target::Window(id) => window(os, wgc, id, options.cursor, &monitors)?,
        Target::Display(id) => {
            let monitor = monitors
                .iter()
                .find(|monitor| monitor.device_name == *id)
                .ok_or(Refusal::bare(EngineCode::InvalidTarget))?;
            displays(os, wgc, std::slice::from_ref(monitor), options.cursor)?
        }
        Target::Desktop => displays(os, wgc, &monitors, options.cursor)?,
    };
    if let Some(region) = options.region {
        record = crop_record(record, region)?;
    }
    if let Some(at) = options.crosshair {
        draw_crosshair(&mut record.bgra, record.width, record.height, at.x, at.y);
    }
    Ok(record)
}

fn window<O: CaptureOs + ?Sized>(
    os: &mut O,
    wgc: bool,
    id: &str,
    cursor: bool,
    monitors: &[Monitor],
) -> Result<FrameRecord, Refusal> {
    let hwnd = parse_window_id(id).ok_or(Refusal::bare(EngineCode::WindowNotFound))?;
    let facts = os
        .window(hwnd)
        .ok_or(Refusal::bare(EngineCode::WindowNotFound))?;
    if facts.iconic {
        return Err(unavailable(Reason::Minimized));
    }
    if facts.cloaked {
        // Until the live tier records WGC frames for another virtual desktop, the user switches.
        return Err(unavailable(Reason::OtherDesktop));
    }
    let scale = monitor_for(monitors, &facts.frame_bounds).map_or(1.0, Monitor::scale);
    if wgc {
        match os.wgc_window(hwnd, cursor) {
            Ok(frame) if !is_blank(&frame.bgra) => {
                return Ok(record(CaptureRoute::Wgc, frame, scale));
            }
            // A blank frame or no item: the floor runs, once.
            Ok(_) | Err(CaptureFault::ItemUnavailable | CaptureFault::NullFrame) => {}
            Err(CaptureFault::Timeout) => return Err(failed(Reason::Timeout)),
        }
    }
    let frame = os.print_window(hwnd, cursor).map_err(from_fault)?;
    let frame = crop(&frame, &facts.frame_bounds.inset(1)).ok_or(failed(Reason::NullFrame))?;
    if is_near_black(&frame.bgra) {
        return Err(failed(Reason::BlackFrame));
    }
    Ok(record(CaptureRoute::PrintWindow, frame, scale))
}

fn displays<O: CaptureOs + ?Sized>(
    os: &mut O,
    wgc: bool,
    monitors: &[Monitor],
    cursor: bool,
) -> Result<FrameRecord, Refusal> {
    let mut frames = Vec::with_capacity(monitors.len());
    let mut dropped = Vec::new();
    let mut shown: Vec<PhysRect> = Vec::new();
    let mut route = if wgc {
        CaptureRoute::Wgc
    } else {
        CaptureRoute::BitBlt
    };
    for monitor in monitors {
        let mut next = shown.clone();
        next.push(monitor.bounds);
        let bound = PhysRect::bounding(&next);
        let pixels =
            u64::try_from(i64::from(bound.width) * i64::from(bound.height)).unwrap_or(u64::MAX);
        if pixels > MAX_COMPOSITE_PIXELS {
            dropped.push(monitor.device_name.clone());
            continue;
        }
        let frame = if wgc {
            match os.wgc_monitor(monitor, cursor) {
                Ok(frame) => frame,
                Err(CaptureFault::ItemUnavailable) => {
                    route = CaptureRoute::BitBlt;
                    os.bitblt_monitor(monitor, cursor).map_err(from_fault)?
                }
                Err(fault) => return Err(from_fault(fault)),
            }
        } else {
            os.bitblt_monitor(monitor, cursor).map_err(from_fault)?
        };
        shown = next;
        frames.push(frame);
    }
    let scale = monitors
        .iter()
        .find(|monitor| !dropped.contains(&monitor.device_name))
        .map_or(1.0, Monitor::scale);
    let frame = composite(&frames).ok_or(failed(Reason::NullFrame))?;
    let mut record = record(route, frame, scale);
    record.dropped = dropped;
    Ok(record)
}

fn record(route: CaptureRoute, frame: RawFrame, scale: f64) -> FrameRecord {
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
