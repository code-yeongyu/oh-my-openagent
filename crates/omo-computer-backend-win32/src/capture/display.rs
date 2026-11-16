//! The display ladder: WGC per monitor when supported, `BitBlt` per monitor otherwise, composited
//! in physical pixels under `MAX_COMPOSITE_PIXELS` with every dropped display named. Under the
//! session cause (`dark`, see [`super::session`]) a near-black composite is
//! `CaptureFailed{black_frame}`; without it a dark desktop is a frame.

use omo_computer_core::backend::Refusal;
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::Reason;
use omo_computer_core::frame::MAX_COMPOSITE_PIXELS;

use super::{
    composite, failed, from_fault, is_near_black, record, CaptureFault, CaptureOs, FrameRecord,
};
use crate::displays::{Monitor, PhysRect};

pub(super) fn capture<O: CaptureOs + ?Sized>(
    os: &mut O,
    wgc: bool,
    monitors: &[Monitor],
    cursor: bool,
    dark: bool,
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
    if dark && is_near_black(&frame.bgra) {
        return Err(failed(Reason::BlackFrame));
    }
    let mut record = record(route, frame, scale);
    record.dropped = dropped;
    Ok(record)
}
