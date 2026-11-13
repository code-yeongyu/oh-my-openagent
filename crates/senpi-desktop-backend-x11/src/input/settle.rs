//! Foreground XTEST delivery waits on the X server, not on time: a window
//! manager may hold every button press under a synchronous grab and replay
//! it to the client later (xfwm4 does, to raise on click). A press sent
//! before the target is under the pointer lands elsewhere, and a focus
//! restore sent while presses are still held races their replay, which then
//! loses them or re-focuses the target.

use std::thread;
use std::time::{Duration, Instant};

use senpi_desktop_core::backend::PointerEvent;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use x11rb::protocol::xproto::Window;

use super::server::InputServer;
use super::X11Input;

/// How long the window manager gets to restack under the pointer, and to
/// replay the presses it holds.
const SETTLE_TIMEOUT: Duration = Duration::from_secs(1);
const SETTLE_POLL: Duration = Duration::from_millis(2);

impl<S: InputServer> X11Input<S> {
    /// XTEST `event` to `window` behind the focus guard; focus returns only
    /// once the window manager released every press it held.
    pub(super) fn pointer_foreground(&mut self, window: Window, event: &PointerEvent) -> CoreResult<()> {
        self.with_foreground(window, |this| {
            this.pointer_xtest(event, Some(window))?;
            this.await_pointer_released(window)
        })
    }

    /// Waits until `window` is on the chain of windows under the pointer.
    ///
    /// # Errors
    /// `InputFailed` when another window still covers the point after the
    /// timeout, so no button is sent to the wrong window.
    pub(super) fn await_pointer_within(&self, window: Window, (x, y): (i16, i16)) -> CoreResult<()> {
        settle(|| self.server.pointer_within(window)).and_then(|within| {
            within.then_some(()).ok_or_else(|| {
                DesktopError::input_failed(format!(
                    "the pointer at ({x}, {y}) is not over window {window}: another window covers the point"
                ))
            })
        })
    }

    /// Waits until no client holds the pointer any more, so every press this
    /// request sent has been delivered before focus moves on.
    ///
    /// # Errors
    /// `InputFailed` when the pointer is still held after the timeout: the
    /// input was sent, but its delivery to `window` is unconfirmed.
    pub(super) fn await_pointer_released(&self, window: Window) -> CoreResult<()> {
        settle(|| self.server.pointer_held().map(|held| !held)).and_then(|released| {
            released.then_some(()).ok_or_else(|| {
                DesktopError::input_failed(format!(
                    "the pointer stayed grabbed after input to window {window}; its delivery is unconfirmed"
                ))
            })
        })
    }
}

/// Re-checks `ready` until it holds or the timeout passes; the last answer.
fn settle(ready: impl Fn() -> CoreResult<bool>) -> CoreResult<bool> {
    let deadline = Instant::now() + SETTLE_TIMEOUT;
    loop {
        if ready()? {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(SETTLE_POLL);
    }
}
