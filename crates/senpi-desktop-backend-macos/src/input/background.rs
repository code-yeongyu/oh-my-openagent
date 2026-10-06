//! Per-window background pointer delivery: SkyLight-stamped posting.
//!
//! This path never calls `CGEventPost(kCGHIDEventTap)`; posting is
//! `SLEventPostToPid`-only (see [`crate::skylight`]). The delivery-policy
//! guard lives in [`super::guard`].

use std::thread;
use std::time::Duration;

use core_graphics::event::{CGEventFlags, CGEventType, CGMouseButton};
use core_graphics::event_source::CGEventSource;
use senpi_desktop_core::backend::{Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

use super::cgevent::{button_types, click_group_id, modifier_flags};
use super::held::{ButtonRoute, Held, HeldButton};
use super::post::{local_point, post_mouse, scroll, ScrollTarget};

pub(super) fn pointer(
    source: &CGEventSource,
    held: &mut Held,
    pid: libc::pid_t,
    wid: u32,
    window: &DesktopWindow,
    event: PointerEvent,
) -> CoreResult<()> {
    match event {
        PointerEvent::Click {
            x,
            y,
            button,
            count,
            modifiers,
        } => click(source, held, pid, wid, window, x, y, button, count, modifiers),
        PointerEvent::Move { x, y } => post_mouse(
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
            click_group_id(),
            CGEventFlags::CGEventFlagNull,
        ),
        PointerEvent::Drag {
            path,
            button,
            modifiers,
        } => drag(source, held, pid, wid, window, &path, button, modifiers),
        PointerEvent::Scroll { x, y, dx, dy } => scroll(
            ScrollTarget {
                source,
                pid,
                wid,
                window,
            },
            x,
            y,
            dx,
            dy,
        ),
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "the parameters are the native CGEvent fields stamped together"
)]
fn click(
    source: &CGEventSource,
    held: &mut Held,
    pid: libc::pid_t,
    wid: u32,
    window: &DesktopWindow,
    x: f64,
    y: f64,
    button: MouseButton,
    count: u32,
    modifiers: Modifiers,
) -> CoreResult<()> {
    let group = click_group_id();
    let (cg_button, down, up, _, number) = button_types(button);
    let flags = modifier_flags(modifiers);
    let route = ButtonRoute::Window(pid, wid, local_point(window, x, y));
    prologue(source, pid, wid, window, x, y, group)?;
    for click_state in 1..=count.max(1) {
        held.button_down(HeldButton { route, button });
        post_mouse(
            source,
            pid,
            wid,
            window,
            down,
            cg_button,
            x,
            y,
            3,
            i64::from(click_state),
            number,
            group,
            flags,
        )?;
        thread::sleep(Duration::from_millis(1));
        post_mouse(
            source,
            pid,
            wid,
            window,
            up,
            cg_button,
            x,
            y,
            3,
            i64::from(click_state),
            number,
            group,
            flags,
        )?;
        held.button_up(&route, button);
        if click_state < count.max(1) {
            thread::sleep(Duration::from_millis(80));
        }
    }
    Ok(())
}

/// The hover-and-tap prologue apps expect before a synthetic background click.
/// The taps carry no real location, so nothing is recorded as held.
fn prologue(
    source: &CGEventSource,
    pid: libc::pid_t,
    wid: u32,
    window: &DesktopWindow,
    x: f64,
    y: f64,
    group: i64,
) -> CoreResult<()> {
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
    post_mouse(
        source,
        pid,
        wid,
        window,
        CGEventType::LeftMouseDown,
        CGMouseButton::Left,
        -1.0,
        -1.0,
        1,
        1,
        0,
        group,
        CGEventFlags::CGEventFlagNull,
    )?;
    thread::sleep(Duration::from_millis(1));
    post_mouse(
        source,
        pid,
        wid,
        window,
        CGEventType::LeftMouseUp,
        CGMouseButton::Left,
        -1.0,
        -1.0,
        2,
        1,
        0,
        group,
        CGEventFlags::CGEventFlagNull,
    )?;
    thread::sleep(Duration::from_millis(100));
    Ok(())
}

#[expect(
    clippy::too_many_arguments,
    reason = "the parameters are the native CGEvent fields stamped together"
)]
fn drag(
    source: &CGEventSource,
    held: &mut Held,
    pid: libc::pid_t,
    wid: u32,
    window: &DesktopWindow,
    path: &[(f64, f64)],
    button: MouseButton,
    modifiers: Modifiers,
) -> CoreResult<()> {
    let Some(&(start_x, start_y)) = path.first() else {
        return Err(DesktopError::input_failed(
            "drag path must contain at least two points",
        ));
    };
    if path.len() < 2 {
        return Err(DesktopError::input_failed(
            "drag path must contain at least two points",
        ));
    }
    let group = click_group_id();
    let (cg_button, down, up, dragged, number) = button_types(button);
    let flags = modifier_flags(modifiers);
    let route = ButtonRoute::Window(pid, wid, local_point(window, start_x, start_y));
    prologue(source, pid, wid, window, start_x, start_y, group)?;
    held.button_down(HeldButton { route, button });
    post_mouse(
        source, pid, wid, window, down, cg_button, start_x, start_y, 3, 1, number, group, flags,
    )?;
    for &(x, y) in &path[1..] {
        thread::sleep(Duration::from_millis(16));
        post_mouse(
            source, pid, wid, window, dragged, cg_button, x, y, 3, 1, number, group, flags,
        )?;
    }
    thread::sleep(Duration::from_millis(50));
    let &(end_x, end_y) = path
        .last()
        .ok_or_else(|| DesktopError::input_failed("drag path is empty"))?;
    let result = post_mouse(
        source, pid, wid, window, up, cg_button, end_x, end_y, 3, 1, number, group, flags,
    );
    if result.is_ok() {
        held.button_up(&route, button);
    }
    result
}
