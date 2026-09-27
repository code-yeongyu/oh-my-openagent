//! xcap capture and display/window enumeration in the per-monitor-v2 DPI
//! regime: displays and windows in global logical coordinates, captures in
//! physical pixels composited at the highest monitor scale.

mod dpi;
mod frame;
mod monitors;
mod windows;

use image::RgbaImage;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow, DisplaySelector, Target};

pub(crate) use self::dpi::enable_per_monitor_awareness;
pub(crate) use self::frame::{logical_bounds, physical_point, PhysicalRect};
use crate::integrity::IntegrityRid;

#[derive(Debug, Clone)]
pub(crate) struct Win32Capture {
    selector: DisplaySelector,
    integrity: IntegrityRid,
}

impl Win32Capture {
    pub(crate) const fn new(selector: DisplaySelector, integrity: IntegrityRid) -> Self {
        Self { selector, integrity }
    }

    pub(crate) fn displays(&self) -> CoreResult<Vec<DesktopDisplay>> {
        Ok(monitors::read(&self.selector)?
            .into_iter()
            .map(|(_, display)| display)
            .collect())
    }

    /// Windows on every display, whatever the session's display selector.
    pub(crate) fn windows(&self) -> CoreResult<Vec<DesktopWindow>> {
        windows::enumerate(&all_displays()?, self.integrity)
    }

    pub(crate) fn capture(&self, target: &Target) -> CoreResult<(RgbaImage, FrameGeometry)> {
        match target {
            Target::Desktop => self.capture_desktop(),
            Target::Window(id) => self.capture_window(id),
        }
    }

    fn capture_desktop(&self) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let mut regions = Vec::new();
        for (monitor, display) in monitors::read(&self.selector)? {
            let image = monitor.capture_image().map_err(|error| {
                DesktopError::capture_failed(format!("capture of display '{}' failed: {error}", display.id))
            })?;
            ensure_nonempty(&image, "display", &display.id)?;
            regions.push((display, image));
        }
        Ok(frame::composite(regions))
    }

    fn capture_window(&self, id: &str) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let image = windows::find_native(id)?.capture_image().map_err(|error| {
            DesktopError::capture_failed(format!("capture of window '{id}' failed: {error}"))
        })?;
        ensure_nonempty(&image, "window", id)?;
        let descriptor = self
            .windows()?
            .into_iter()
            .find(|window| window.id == id)
            .ok_or_else(|| DesktopError::window_not_found(format!("target window '{id}' disappeared")))?;
        let geometry = FrameGeometry::for_window(&descriptor, image.width(), image.height());
        Ok((image, geometry))
    }
}

/// Every active display, whatever a session's display selector: the layout
/// window and element coordinates are resolved against.
pub(crate) fn all_displays() -> CoreResult<Vec<DesktopDisplay>> {
    Ok(monitors::read(&DisplaySelector::All)?
        .into_iter()
        .map(|(_, display)| display)
        .collect())
}

fn ensure_nonempty(image: &RgbaImage, kind: &str, id: &str) -> CoreResult<()> {
    if image.width() == 0 || image.height() == 0 {
        return Err(DesktopError::capture_failed(format!(
            "capture of {kind} '{id}' returned an empty image"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod live_tests;
