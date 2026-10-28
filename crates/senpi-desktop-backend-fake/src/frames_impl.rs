use image::RgbaImage;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::{FrameGeometry, MAX_COMPOSITE_PIXELS};
use senpi_desktop_core::types::{DisplaySelector, Target};

use crate::fake::FakeBackend;
use crate::method::FakeMethod;

impl FakeBackend {
    /// The native-size solid image of `target`; the session applies caps.
    pub(crate) fn capture_impl(&mut self, target: &Target) -> CoreResult<(RgbaImage, FrameGeometry)> {
        self.begin(FakeMethod::Capture)?;
        if !self.capabilities.capture {
            return Err(DesktopError::capture_failed("capture is unavailable in this fake scenario"));
        }
        let (frame, width, height) = self.frame(target)?;
        let frame = if self.legacy_capture { frame.into_legacy_capture() } else { frame };
        if width == 0 || height == 0 {
            return Err(DesktopError::capture_failed("fake scenario has nothing to capture"));
        }
        if u64::from(width) * u64::from(height) > MAX_COMPOSITE_PIXELS {
            return Err(DesktopError::capture_failed(format!(
                "composite {width}x{height} exceeds the native safety limit"
            )));
        }
        let image = RgbaImage::from_pixel(width, height, self.capture_color);
        self.apply_scripted_resize(target);
        Ok((image, frame))
    }

    pub(crate) fn frame(&self, target: &Target) -> CoreResult<(FrameGeometry, u32, u32)> {
        match target {
            Target::Desktop | Target::Display(_) => {
                let selector = target.display_selector().unwrap_or(DisplaySelector::All);
                let focused = self.windows.iter().find(|window| window.focused);
                let mut displays = selector.select(self.displays.clone(), focused)?;
                if displays.len() == 1 {
                    displays[0].pixel_x = 0;
                    displays[0].pixel_y = 0;
                }
                let width = displays.iter().map(|d| d.pixel_x.saturating_add(d.pixel_width)).max().unwrap_or(0);
                let height = displays.iter().map(|d| d.pixel_y.saturating_add(d.pixel_height)).max().unwrap_or(0);
                Ok((FrameGeometry::for_displays(&displays), width, height))
            }
            Target::Window(id) => {
                let window = self.window(id)?;
                let frame = FrameGeometry::for_window(window, window.width, window.height);
                Ok((frame, window.width, window.height))
            }
        }
    }

    pub(crate) fn apply_scripted_resize(&mut self, target: &Target) {
        let Target::Window(id) = target else { return };
        let Some(resize) = self.resize_window.take_if(|resize| &resize.id == id) else {
            return;
        };
        if let Some(window) = self.windows.iter_mut().find(|window| window.id == resize.id) {
            window.width = resize.width;
            window.height = resize.height;
        }
    }
}
