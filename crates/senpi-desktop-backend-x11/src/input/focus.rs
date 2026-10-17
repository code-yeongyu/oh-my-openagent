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
        self.server.focus_window().is_ok()
    }

    pub(crate) fn window_owns_foreground(&self, id: &str) -> CoreResult<bool> {
        let window = super::parse_window(id)?;
        self.focus_confirmed(window, self.server.active_window().is_some())
    }

    /// Activates `window`, runs `body`, then re-activates the previously
    /// active window. `body`'s error wins over a failed restore.
    pub(super) fn with_foreground<T>(
        &mut self,
        window: Window,
        body: impl FnOnce(&mut Self) -> CoreResult<T>,
    ) -> CoreResult<T> {
        let previous = self.active_window();
        let previous_focus = self.server.focus_window()?;
        self.activate(window)?;
        let result = body(self);
        let restored = self.restore_focus(window, previous, previous_focus);
        let value = result?;
        restored.map(|()| value)
    }

    /// Asks the window manager to activate `window` and waits until both its
    /// active-window state (when published) and core focus confirm it.
    ///
    /// # Errors
    /// `InputFailed` when the request fails or the window manager keeps
    /// another window active past the timeout.
    pub(super) fn activate(&self, window: Window) -> CoreResult<()> {
        let tracks_active = self.server.active_window().is_some();
        if self.focus_confirmed(window, tracks_active)? {
            return Ok(());
        }
        self.server.activate(window)?;
        if !tracks_active {
            self.server.set_focus(window)?;
        }
        let deadline = Instant::now() + ACTIVATION_TIMEOUT;
        loop {
            if self.focus_confirmed(window, tracks_active)? {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err(DesktopError::input_failed(format!(
                    "window {window} did not become active and focused"
                )));
            }
            thread::sleep(ACTIVATION_POLL);
        }
    }

    fn focus_confirmed(&self, window: Window, tracks_active: bool) -> CoreResult<bool> {
        Ok((!tracks_active || self.active_window() == Some(window)) && self.focus_within(window)?)
    }

    fn focus_within(&self, window: Window) -> CoreResult<bool> {
        let mut focus = self.server.focus_window()?;
        for _ in 0..32 {
            if focus == window {
                return Ok(true);
            }
            if focus == 0 || focus == self.server.root() {
                return Ok(false);
            }
            let Some(parent) = self.server.parent(focus)? else {
                return Ok(false);
            };
            focus = parent;
        }
        Ok(false)
    }

    fn restore_focus(
        &self,
        window: Window,
        previous_active: Option<Window>,
        previous_focus: Window,
    ) -> CoreResult<()> {
        let tracks_active = self.server.active_window().is_some();
        if !self.focus_confirmed(window, tracks_active)? {
            return Ok(());
        }
        match previous_active {
            Some(previous) if previous != window => self.activate(previous),
            Some(_) => Ok(()),
            None if previous_focus != window && previous_focus != self.server.root() => {
                self.server.set_focus(previous_focus)
            }
            None => Ok(()),
        }
    }
}
