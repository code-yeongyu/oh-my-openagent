use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopWindow, DisplaySelector, Target, WindowIdentity};
use senpi_desktop_core::user_input::UserInputFeed;

use crate::fake::FakeBackend;

impl FakeBackend {
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
                let window = self.identified(self.window(id)?);
                let frame = FrameGeometry::for_window(&window, window.width, window.height);
                Ok((frame, window.width, window.height))
            }
        }
    }

    /// `window` with the identity its scripted owning process reports; a
    /// window whose process has no scripted start time stays unidentified.
    pub(crate) fn identified(&self, window: &DesktopWindow) -> DesktopWindow {
        let identity = window.pid.and_then(|pid| {
            self.user_input.process_started(pid).map(|start| WindowIdentity {
                window_number: window.id.clone(),
                pid,
                process_start: Some(start),
            })
        });
        DesktopWindow {
            identity,
            ..window.clone()
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
