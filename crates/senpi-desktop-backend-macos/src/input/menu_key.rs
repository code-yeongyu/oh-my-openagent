//! Making a window key for a menu command: the sole-window rule and the
//! activation record that background keystrokes use, with menu-specific
//! refusals (`menus.select` has no delivery option to fall back on).

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

use super::{window_identity, MacInput};
use crate::capture::MacCapture;
use crate::skylight;

impl MacInput {
    /// Makes `window` key without raising it, refusing when its application
    /// owns more than one window: a menu command acts on whichever window the
    /// application treats as key, which the session's focus restore may change
    /// before AppKit runs the command. Records the activation so key focus is
    /// handed back afterwards.
    pub(crate) fn make_menu_window_key(&mut self, window: &DesktopWindow, capture: &MacCapture) -> CoreResult<()> {
        let (pid, wid) = window_identity(window)?;
        let siblings = capture
            .windows()?
            .into_iter()
            .filter(|candidate| candidate.pid == window.pid)
            .count();
        if siblings > 1 {
            return Err(DesktopError::background_unavailable(format!(
                "this app has several windows ({siblings}); menu commands need the foreground grant \
                 to target window {wid} (#9888), so nothing was dispatched; use ax actions on the \
                 target window instead",
            )));
        }
        skylight::activate_without_raise(pid, wid).map_err(|error| {
            DesktopError::background_unavailable(format!(
                "window {wid} could not be made its application's key window without raising it \
                 ({}); no menu command was dispatched",
                error.message
            ))
        })?;
        self.last_activated = Some((pid, wid));
        Ok(())
    }
}
