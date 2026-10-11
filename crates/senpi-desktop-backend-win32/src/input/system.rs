//! `SendInput` primitives: synthesized events on the system input queue,
//! which reach whatever window has the foreground (keys) or lies under the
//! cursor (pointer). Absolute moves are normalized over the whole virtual
//! desktop, so every monitor is reachable.

use std::mem::size_of;

use senpi_desktop_core::backend::MouseButton;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN,
    MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

use super::barrier;
use super::cursor_placement::{self, Mover};
use super::events::{key_event, mouse_event};
use super::messages::absolute_coordinate;
use super::native::{self, Window};
use super::recovery::release_accepted_prefix;

/// An unassigned virtual key (no layout or command maps it): the delivery
/// barrier's sentinel.
const VK_BARRIER: u16 = 0xE8;

/// Inserts `events` into the system input queue in one call, so no other
/// input interleaves with them.
fn send(events: &[INPUT], target: Option<Window>) -> CoreResult<()> {
    let size = i32::try_from(size_of::<INPUT>()).unwrap_or(i32::MAX);
    let count = u32::try_from(events.len())
        .map_err(|_| DesktopError::input_failed("too many input events for one SendInput call"))?;
    if target.is_some_and(|target| native::foreground() != Some(target)) {
        return Err(DesktopError::input_failed(
            "the exact target lost foreground; stopped sending foreground input",
        ));
    }
    // SAFETY: [FFI] `events` is `count` fully initialized INPUTs that Win32
    // copies synchronously; `size` is the exact size of one.
    let sent = unsafe { SendInput(count, events.as_ptr(), size) };
    if sent == count {
        return Ok(());
    }
    let accepted = usize::try_from(sent).unwrap_or(usize::MAX).min(events.len());
    let cleanup = release_accepted_prefix(events, accepted, |release| {
        // SAFETY: [Category 8 - FFI boundary] `release` is one initialized
        // INPUT built by this module. Win32 copies it synchronously.
        (unsafe { SendInput(1, release, size) }) == 1
    });
    let failure = DesktopError::input_failed(format!(
        "Win32 SendInput inserted {sent} of {count} events; the action may be partially applied: {}",
        std::io::Error::last_os_error()
    ));
    if cleanup {
        Err(failure)
    } else {
        Err(DesktopError::input_failed(format!(
            "{}; cleanup also failed: Win32 SendInput could not release an inserted input",
            failure.message
        )))
    }
}

/// Presses (`down`) or releases virtual key `vk`.
pub(super) fn key(vk: u16, down: bool, target: Option<Window>) -> CoreResult<()> {
    // A foreground handoff blocks new presses, not release of an inserted key.
    send(
        &[key_event(vk, 0, if down { 0 } else { KEYEVENTF_KEYUP })],
        if down { target } else { None },
    )
}

/// Types UTF-16 units layout-independently (`KEYEVENTF_UNICODE`), all in
/// one `SendInput` call.
pub(super) fn unicode_text(
    units: impl Iterator<Item = u16>,
    target: Option<Window>,
) -> CoreResult<()> {
    let events = units
        .flat_map(|unit| {
            [
                key_event(0, unit, KEYEVENTF_UNICODE),
                key_event(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
            ]
        })
        .collect::<Vec<_>>();
    if events.is_empty() {
        return Ok(());
    }
    send(&events, target)
}

/// Presses (`down`) or releases the barrier sentinel key.
pub(super) fn barrier_key(down: bool, target: Option<Window>) -> CoreResult<()> {
    key(VK_BARRIER, down, target)
}

/// Whether the raw input thread has processed a press of the sentinel key
/// that no release has followed yet: it updates the async key state as it
/// routes each event, in queue order.
pub(super) fn barrier_key_down() -> bool {
    // SAFETY: [FFI] a scalar read of the global async key state.
    let state = unsafe { GetAsyncKeyState(i32::from(VK_BARRIER)) };
    state < 0
}

/// Makes this process the source of the last input event with a zero
/// relative mouse move (no motion, no button). `SetForegroundWindow` only
/// succeeds for the process that received the last input event, which an
/// engine driven over stdio never is on its own.
pub(super) fn claim_last_input() -> CoreResult<()> {
    send(&[mouse_event(MOUSEEVENTF_MOVE, 0, 0, 0)], None)
}

/// Puts the cursor on a physical virtual-desktop point and confirms it is
/// there before the caller sends a button or wheel: the `SendInput` move,
/// read back once the raw input thread routed it, then `SetCursorPos` when
/// the cursor is still elsewhere (another process clipped or moved it).
///
/// # Errors
/// `InputFailed` when a move is refused, the cursor cannot be read, or
/// neither move put it on the point.
pub(super) fn place_cursor(point: (i32, i32), target: Option<Window>) -> CoreResult<()> {
    cursor_placement::place(
        point,
        |mover| match mover {
            Mover::SendInput => move_to(point, target),
            Mover::SetCursorPos => native::set_cursor(point.0, point.1),
        },
        || {
            barrier::routed(target)?;
            native::cursor()
        },
    )
    .map(drop)
}

/// Moves the cursor to a physical virtual-desktop point.
fn move_to((x, y): (i32, i32), target: Option<Window>) -> CoreResult<()> {
    // SAFETY: [FFI] `GetSystemMetrics` takes a scalar index and has no
    // preconditions.
    let (origin_x, origin_y, width, height) = unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    };
    let (Some(dx), Some(dy)) = (
        absolute_coordinate(x, origin_x, width),
        absolute_coordinate(y, origin_y, height),
    ) else {
        return Err(DesktopError::input_failed(
            "Win32 virtual desktop geometry is unavailable",
        ));
    };
    let flags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    send(&[mouse_event(flags, 0, dx, dy)], target)
}

/// Presses (`down`) or releases `button` where the cursor is.
pub(super) fn button(
    button: MouseButton,
    down: bool,
    target: Option<Window>,
) -> CoreResult<()> {
    let flags = match (button, down) {
        (MouseButton::Left, true) => MOUSEEVENTF_LEFTDOWN,
        (MouseButton::Left, false) => MOUSEEVENTF_LEFTUP,
        (MouseButton::Right, true) => MOUSEEVENTF_RIGHTDOWN,
        (MouseButton::Right, false) => MOUSEEVENTF_RIGHTUP,
        (MouseButton::Middle, true) => MOUSEEVENTF_MIDDLEDOWN,
        (MouseButton::Middle, false) => MOUSEEVENTF_MIDDLEUP,
    };
    send(&[mouse_event(flags, 0, 0, 0)], target)
}

/// One wheel event of `delta` (multiples of `WHEEL_DELTA`) on an axis.
pub(super) fn wheel(
    horizontal: bool,
    delta: i32,
    target: Option<Window>,
) -> CoreResult<()> {
    let flags = if horizontal {
        MOUSEEVENTF_HWHEEL
    } else {
        MOUSEEVENTF_WHEEL
    };
    send(&[mouse_event(flags, delta, 0, 0)], target)
}
