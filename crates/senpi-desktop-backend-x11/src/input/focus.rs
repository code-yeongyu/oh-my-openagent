//! The focus guard over EWMH `_NET_ACTIVE_WINDOW`: foreground delivery
//! activates the target, confirms the window manager made it active, acts,
//! and hands activation back to the window that had it.

use std::thread;
use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError};
use x11rb::protocol::xproto::Window;

use super::server::InputServer;
use super::X11Input;

/// How long the window manager gets to honour an activation request.
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(1);
const ACTIVATION_POLL: Duration = Duration::from_millis(5);

impl<S: InputServer> X11Input<S> {
    /// The active window, when a window manager publishes one.
    pub fn active_window(&self) -> Option<Window> {
        self.server.active_window().filter(|&window| window != 0)
    }

    /// Whether the window manager publishes `_NET_ACTIVE_WINDOW`, so the
    /// focus guard can capture and restore it.
    pub fn focus_guard_available(&self) -> bool {
        self.server.active_window().is_some()
    }

    /// Activates `window`, runs `body`, then re-activates the previously
    /// active window. `body`'s error wins over a failed restore.
    pub(super) fn with_foreground<T>(
        &mut self,
        window: Window,
        body: impl FnOnce(&mut Self) -> CoreResult<T>,
    ) -> CoreResult<T> {
        let previous = self.active_window();
        self.activate(window)?;
        let result = body(self);
        let restored = match previous {
            Some(previous) if previous != window => self.activate(previous),
            Some(_) | None => Ok(()),
        };
        let value = result?;
        restored.map(|()| value)
    }

    /// Asks the window manager to activate `window` and waits until it
    /// reports so. Without an EWMH window manager nothing can confirm it,
    /// and the request is the whole guarantee.
    ///
    /// # Errors
    /// `InputFailed` when the request fails or the window manager keeps
    /// another window active past the timeout.
    pub(super) fn activate(&self, window: Window) -> CoreResult<()> {
        if self.server.active_window() == Some(window) {
            return Ok(());
        }
        self.server.activate(window)?;
        let deadline = Instant::now() + ACTIVATION_TIMEOUT;
        loop {
            match self.server.active_window() {
                None => return Ok(()),
                Some(active) if active == window => return Ok(()),
                Some(active) if Instant::now() >= deadline => {
                    return Err(DesktopError::input_failed(format!(
                        "the window manager did not activate window {window} (window {active} stayed active)"
                    )));
                }
                Some(_) => thread::sleep(ACTIVATION_POLL),
            }
        }
    }
}
