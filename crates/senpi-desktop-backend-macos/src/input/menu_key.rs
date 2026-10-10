//! Making a window key for a menu command, through the same sole-window rule
//! and activation record that background keystrokes use.

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::DesktopWindow;

use super::{guard, window_identity, MacInput};
use crate::capture::MacCapture;

impl MacInput {
    /// Makes `window` key without raising it, refusing when its application
    /// owns more than one window: a menu command acts on whichever window the
    /// application treats as key, which the session's focus restore may change
    /// before AppKit runs the command. Records the activation so key focus is
    /// handed back afterwards.
    pub(crate) fn make_menu_window_key(&mut self, window: &DesktopWindow, capture: &MacCapture) -> CoreResult<()> {
        let (pid, wid) = window_identity(window)?;
        guard::prepare_keys(window, pid, wid, capture)?;
        self.last_activated = Some((pid, wid));
        Ok(())
    }
}
