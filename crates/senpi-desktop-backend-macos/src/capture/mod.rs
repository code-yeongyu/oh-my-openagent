//! Quartz capture: TCC preflight, display/window enumeration, and
//! `screencapture`-based capture with a display-only CoreGraphics fallback.
//! Never prompts for permission and never uses ScreenCaptureKit.

mod displays;
mod fallback;
mod screencapture;
mod windows;

use image::RgbaImage;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow, DisplaySelector, Target};

pub(crate) use self::screencapture::Screencapture;
use self::screencapture::{display_args, window_args, ShotError};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    /// Non-prompting TCC preflight for Screen Recording; takes no arguments.
    safe fn CGPreflightScreenCaptureAccess() -> bool;
}

/// Whether this process may capture the screen, without prompting.
pub(crate) fn capture_permission() -> bool {
    CGPreflightScreenCaptureAccess()
}

/// `PermissionDenied` naming the executable identity TCC evaluates, since a
/// grant for Terminal or another launcher does not transfer automatically.
pub(crate) fn permission_denied() -> DesktopError {
    let executable = std::env::current_exe()
        .map_or_else(|_| "<unavailable>".to_string(), |path| path.display().to_string());
    DesktopError::permission_denied(format!(
        "macOS Screen Recording permission is not granted for this process (TCC identity: executable={executable}, pid={})",
        std::process::id()
    ))
}

#[derive(Debug, Clone)]
pub(crate) struct MacCapture {
    selector: DisplaySelector,
    shooter: Screencapture,
}

impl MacCapture {
    pub(crate) fn new(selector: DisplaySelector, shooter: Screencapture) -> Self {
        Self { selector, shooter }
    }

    pub(crate) fn permission_granted(&self) -> bool {
        self.shooter.permission_granted()
    }

    pub(crate) fn displays(&self) -> CoreResult<Vec<DesktopDisplay>> {
        self.require_permission()?;
        displays::enumerate(&self.selector)
    }

    pub(crate) fn windows(&self) -> CoreResult<Vec<DesktopWindow>> {
        self.require_permission()?;
        windows::enumerate()
    }

    pub(crate) fn capture(&self, target: &Target) -> CoreResult<(RgbaImage, FrameGeometry)> {
        match target {
            Target::Desktop => self.capture_desktop(),
            Target::Window(id) => self.capture_window(id),
        }
    }

    fn require_permission(&self) -> CoreResult<()> {
        if self.permission_granted() {
            Ok(())
        } else {
            Err(permission_denied())
        }
    }

    /// One `screencapture -x -R<rect>` per display, composited. When the tool
    /// is absent or fails with permission granted, the primary display is
    /// captured through CoreGraphics instead.
    fn capture_desktop(&self) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let displays = self.displays()?;
        let mut regions = Vec::with_capacity(displays.len());
        for display in &displays {
            let image = match self.shooter.run(&display_args(display)) {
                Ok(image) => image,
                Err(ShotError::Unavailable(reason)) => {
                    return fallback::capture_primary(&displays, &reason);
                }
                Err(ShotError::Fatal(error)) => return Err(error),
            };
            if image.width() == 0 || image.height() == 0 {
                return Err(DesktopError::capture_failed(format!(
                    "capture of display '{}' returned an empty image",
                    display.id
                )));
            }
            regions.push((display.clone(), image));
        }
        displays::composite(regions)
    }

    /// `screencapture -x -o -l <wid>`; window capture has no fallback.
    fn capture_window(&self, id: &str) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let window_id = id
            .parse::<u32>()
            .map_err(|_| DesktopError::invalid_target(format!("invalid macOS window id '{id}'")))?;
        self.require_permission()?;
        let window = windows::find(id)?;
        let image = self
            .shooter
            .run(&window_args(window_id))
            .map_err(DesktopError::from)?;
        if image.width() == 0 || image.height() == 0 {
            return Err(DesktopError::capture_failed(format!(
                "capture of window '{id}' returned an empty image"
            )));
        }
        let geometry = FrameGeometry::for_window(&window, image.width(), image.height());
        Ok((image, geometry))
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod live_tests;
