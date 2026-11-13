//! The window ladder: WGC when supported, the `PrintWindow` floor (cropped, near-black oracle)
//! otherwise, and for an elevated window WGC only (SP-N #13145@e32a295a17:n-elevated-printwindow).
//! Under the session cause (`dark`, see [`super::session`]) a near-black WGC frame is
//! `CaptureFailed{black_frame}` instead of a frame.

use omo_computer_core::backend::Refusal;
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::{EngineCode, Reason};

use super::{
    crop, failed, from_fault, is_blank, is_near_black, parse_window_id, record, unavailable,
    CaptureFault, CaptureOs, FrameRecord, RawFrame, ELEVATED,
};
use crate::displays::{monitor_for, Monitor};

pub(super) fn capture<O: CaptureOs + ?Sized>(
    os: &mut O,
    wgc: bool,
    id: &str,
    cursor: bool,
    monitors: &[Monitor],
    dark: bool,
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
    if facts.elevated {
        return elevated_window(os, wgc, hwnd, cursor, scale, dark);
    }
    if wgc {
        match os.wgc_window(hwnd, cursor) {
            Ok(frame) if !is_blank(&frame.bgra) => return wgc_frame(frame, scale, dark),
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

/// WGC is the only route to an elevated window; its one retry on a blank frame is a second WGC
/// frame, and a WGC that cannot serve the window answers [`ELEVATED`] with nothing captured.
fn elevated_window<O: CaptureOs + ?Sized>(
    os: &mut O,
    wgc: bool,
    hwnd: isize,
    cursor: bool,
    scale: f64,
    dark: bool,
) -> Result<FrameRecord, Refusal> {
    if !wgc {
        return Err(ELEVATED);
    }
    for _ in 0..2 {
        match os.wgc_window(hwnd, cursor) {
            Ok(frame) if !is_blank(&frame.bgra) => return wgc_frame(frame, scale, dark),
            Ok(_) => {}
            Err(CaptureFault::Timeout) => return Err(failed(Reason::Timeout)),
            Err(CaptureFault::ItemUnavailable | CaptureFault::NullFrame) => return Err(ELEVATED),
        }
    }
    Err(ELEVATED)
}

/// A non-blank WGC frame: refused as `CaptureFailed{black_frame}` when near black under the
/// session cause, otherwise the frame.
fn wgc_frame(frame: RawFrame, scale: f64, dark: bool) -> Result<FrameRecord, Refusal> {
    if dark && is_near_black(&frame.bgra) {
        return Err(failed(Reason::BlackFrame));
    }
    Ok(record(CaptureRoute::Wgc, frame, scale))
}
