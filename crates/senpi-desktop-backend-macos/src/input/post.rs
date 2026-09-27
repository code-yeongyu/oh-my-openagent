//! The SkyLight-stamped posting primitives: window-local coordinates, the
//! scroll event, and the one `post_mouse` every background pointer event goes
//! through. No HID tap call exists on this path.

use std::thread;
use std::time::Duration;

use core_graphics::event::{CGEvent, CGEventFlags, CGEventType, CGMouseButton, ScrollEventUnit};
use core_graphics::event_source::CGEventSource;
use core_graphics::geometry::CGPoint;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

use super::cgevent::{click_group_id, finite_i32};
use crate::skylight;

/// The window-local point of a stamped event; `(-1, -1)` marks the synthetic
/// prologue taps, which carry no location.
pub(super) fn local_point(window: &DesktopWindow, x: f64, y: f64) -> CGPoint {
    if x == -1.0 && y == -1.0 {
        CGPoint::new(-1.0, -1.0)
    } else {
        CGPoint::new(x - f64::from(window.x), y - f64::from(window.y))
    }
}

/// A scroll's target identity: where it is posted and in which window.
pub(super) struct ScrollTarget<'a> {
    pub(super) source: &'a CGEventSource,
    pub(super) pid: libc::pid_t,
    pub(super) wid: u32,
    pub(super) window: &'a DesktopWindow,
}

pub(super) fn scroll(target: ScrollTarget<'_>, x: f64, y: f64, dx: f64, dy: f64) -> CoreResult<()> {
    let ScrollTarget {
        source,
        pid,
        wid,
        window,
    } = target;
    let group = click_group_id();
    post_mouse(
        source,
        pid,
        wid,
        window,
        CGEventType::MouseMoved,
        CGMouseButton::Left,
        x,
        y,
        2,
        0,
        0,
        group,
        CGEventFlags::CGEventFlagNull,
    )?;
    thread::sleep(Duration::from_millis(15));
    let wheel_x = finite_i32(dx, "horizontal scroll delta")?;
    let wheel_y = finite_i32(dy, "vertical scroll delta")?;
    let event = CGEvent::new_scroll_event(source.clone(), ScrollEventUnit::PIXEL, 2, wheel_y, wheel_x, 0)
        .map_err(|()| DesktopError::input_failed("failed to create a Quartz scroll event"))?;
    event.set_location(CGPoint::new(x, y));
    skylight::stamp_event(&event, pid, wid, local_point(window, x, y), 3, 0, 0, group)?;
    skylight::post_dual(pid, &event)
}

/// Posts one stamped pointer event to `(pid, wid)` through SkyLight and the
/// public per-pid queue.
#[expect(
    clippy::too_many_arguments,
    reason = "the parameters are the native CGEvent fields stamped together"
)]
pub(super) fn post_mouse(
    source: &CGEventSource,
    pid: libc::pid_t,
    wid: u32,
    window: &DesktopWindow,
    event_type: CGEventType,
    button: CGMouseButton,
    x: f64,
    y: f64,
    phase: i64,
    click_state: i64,
    button_number: i64,
    click_group: i64,
    flags: CGEventFlags,
) -> CoreResult<()> {
    let event = CGEvent::new_mouse_event(source.clone(), event_type, CGPoint::new(x, y), button)
        .map_err(|()| DesktopError::input_failed("failed to create a Quartz pointer event"))?;
    // Flags are exactly the caller-requested modifier set; no background bypass
    // modifier is injected.
    event.set_flags(flags);
    skylight::stamp_event(
        &event,
        pid,
        wid,
        local_point(window, x, y),
        phase,
        click_state,
        button_number,
        click_group,
    )?;
    skylight::post_dual(pid, &event)
}
