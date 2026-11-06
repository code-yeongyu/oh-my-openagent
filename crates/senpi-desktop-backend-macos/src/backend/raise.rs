use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::MacosBackend;

impl MacosBackend {
    /// `AXRaise` on the window, then an AppKit activation of its app: the
    /// `raise_window` request, which brings the window to the user's front.
    pub(super) fn raise(&mut self, id: &str) -> CoreResult<()> {
        let window = self
            .capture
            .windows()?
            .into_iter()
            .find(|window| window.id == id)
            .ok_or_else(|| {
                DesktopError::window_not_found(format!(
                    "window '{id}' was not found; it may be closed or minimized"
                ))
            })?;
        self.ax.raise(&window)?;
        let pid = window
            .pid
            .ok_or_else(|| DesktopError::input_failed(format!("window {id} has no owning process id")))?;
        let pid = i32::try_from(pid)
            .map_err(|_| DesktopError::input_failed(format!("window {id} has an invalid process id")))?;
        let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid).ok_or_else(|| {
            DesktopError::window_not_found(format!("application for window '{id}' is no longer running"))
        })?;
        if !app.activateWithOptions(NSApplicationActivationOptions::empty()) {
            return Err(DesktopError::input_failed(format!(
                "activation request for window '{id}' was rejected"
            )));
        }
        Ok(())
    }
}
