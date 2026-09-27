//! The delivery barrier of foreground input. `SendInput` only appends to
//! the raw input thread's (RIT) queue; the RIT routes each event to the
//! thread that owns the foreground when it gets to it, and that thread takes
//! it off its own queue later. Handing the foreground back straight after
//! `SendInput` therefore sends the tail of the input to the previous window
//! or nowhere. [`delivered`] waits for both hops on signals Win32 produces,
//! each bounded by a hang guard:
//!
//! 1. Routed: a sentinel press of an unassigned key goes in after the input.
//!    The RIT updates the async key state as it routes each event, in queue
//!    order, so once `GetAsyncKeyState` reports the sentinel down every
//!    earlier event reached the target's thread. Its release is awaited the
//!    same way, so no transition of it is left for the previous window.
//! 2. Consumed: a one-pixel invalidation of the target thread's focus
//!    window. Win32 generates `WM_PAINT` only when the thread's sent, posted
//!    and input queues are empty, so once `GetUpdateRect` reports the window
//!    clean the thread has taken - and dispatched - every routed event and
//!    the messages they posted (`WM_CHAR`).
//!
//! No hook and no `AttachThreadInput`: the barrier only observes.

use std::thread;
use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError};
use windows_sys::Win32::Foundation::RECT;
use windows_sys::Win32::Graphics::Gdi::{GetUpdateRect, InvalidateRect};
use windows_sys::Win32::UI::WindowsAndMessaging::IsWindowVisible;

use super::native::Window;
use super::system;

/// Hang guard only: the RIT and an idle target take well under a frame.
const HANG_GUARD: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(1);

/// Waits until every input sent so far was routed to `target`'s thread and
/// that thread has processed it.
///
/// # Errors
/// `InputFailed` when the sentinel cannot be sent, or a hop is not observed
/// within the hang guard.
pub(super) fn delivered(target: Window) -> CoreResult<()> {
    routed()?;
    consumed(paint_probe(target))
}

fn routed() -> CoreResult<()> {
    if system::barrier_key_down() {
        system::barrier_key(false)?;
        wait("the stale barrier key release", || !system::barrier_key_down())?;
    }
    system::barrier_key(true)?;
    let pressed = wait("the barrier key press", system::barrier_key_down);
    system::barrier_key(false)?;
    pressed?;
    wait("the barrier key release", || !system::barrier_key_down())
}

/// The window whose paint proves the target thread drained its queues: the
/// thread's focus window when it is visible (it took the keys), else the
/// target itself.
fn paint_probe(target: Window) -> Window {
    let focus = target.keyboard_focus();
    // SAFETY: [FFI] the HWND is an opaque value; a stale one reads as hidden.
    if unsafe { IsWindowVisible(focus.hwnd()) } != 0 {
        focus
    } else {
        target
    }
}

fn consumed(window: Window) -> CoreResult<()> {
    let pixel = RECT {
        left: 0,
        top: 0,
        right: 1,
        bottom: 1,
    };
    // SAFETY: [FFI] `pixel` is a valid RECT Win32 reads during the call; the
    // HWND is opaque and validated by Win32.
    if unsafe { InvalidateRect(window.hwnd(), &raw const pixel, 0) } == 0 {
        return Err(DesktopError::input_failed(format!(
            "InvalidateRect failed for window {}: {}",
            window.address(),
            std::io::Error::last_os_error()
        )));
    }
    // SAFETY: [FFI] a null rect asks only whether the update region is empty.
    wait("the target window to process the input", || unsafe {
        GetUpdateRect(window.hwnd(), std::ptr::null_mut(), 0) == 0
    })
}

/// Polls `done` until it holds or the hang guard expires.
fn wait(what: &str, done: impl Fn() -> bool) -> CoreResult<()> {
    let deadline = Instant::now() + HANG_GUARD;
    while !done() {
        if Instant::now() >= deadline {
            return Err(DesktopError::input_failed(format!(
                "foreground input delivery: timed out after {HANG_GUARD:?} waiting for {what}"
            )));
        }
        thread::sleep(POLL);
    }
    Ok(())
}
