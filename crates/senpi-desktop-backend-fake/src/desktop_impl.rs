use image::RgbaImage;
use senpi_desktop_core::backend::{AxBackend, Backend, DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::{FrameGeometry, MAX_COMPOSITE_PIXELS};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopPoint, DesktopWindow, FrontWindow, Target,
};

use crate::fake::FakeBackend;
use crate::method::FakeMethod;
use crate::sink::{RecordedPointer, SinkOp};

impl FakeBackend {
    /// Native-size frame of `target`: the display composite, or the window at
    /// one pixel per logical point.
    fn frame(&self, target: &Target) -> CoreResult<(FrameGeometry, u32, u32)> {
        match target {
            Target::Desktop => {
                let extent = |edge: fn(&DesktopDisplay) -> u32| self.displays.iter().map(edge).max();
                let width = extent(|d| d.pixel_x.saturating_add(d.pixel_width)).unwrap_or(0);
                let height = extent(|d| d.pixel_y.saturating_add(d.pixel_height)).unwrap_or(0);
                Ok((FrameGeometry::for_displays(&self.displays), width, height))
            }
            Target::Window(id) => {
                let window = self.window(id)?;
                let frame = FrameGeometry::for_window(window, window.width, window.height);
                Ok((frame, window.width, window.height))
            }
        }
    }

    fn apply_scripted_resize(&mut self, target: &Target) {
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

impl Backend for FakeBackend {
    fn capabilities(&mut self) -> DesktopCapabilities {
        self.capabilities.clone()
    }

    fn displays(&mut self) -> CoreResult<Vec<DesktopDisplay>> {
        self.begin(FakeMethod::Displays)?;
        Ok(self.displays.clone())
    }

    fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>> {
        self.begin(FakeMethod::Windows)?;
        Ok(self.windows.clone())
    }

    /// Returns the native-size solid image; the session applies `caps`.
    fn capture(&mut self, target: &Target, _caps: &CaptureCaps) -> CoreResult<(RgbaImage, FrameGeometry)> {
        self.begin(FakeMethod::Capture)?;
        if !self.capabilities.capture {
            return Err(DesktopError::capture_failed(
                "capture is unavailable in this fake scenario",
            ));
        }
        let (frame, width, height) = self.frame(target)?;
        if width == 0 || height == 0 {
            return Err(DesktopError::capture_failed(
                "fake scenario has nothing to capture",
            ));
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

    fn pointer(
        &mut self,
        target: &Target,
        ev: PointerEvent,
        _frame: &FrameGeometry,
        mode: DeliveryMode,
    ) -> CoreResult<()> {
        let method = match &ev {
            PointerEvent::Click { .. } => FakeMethod::Click,
            PointerEvent::Move { .. } => FakeMethod::Move,
            PointerEvent::Drag { .. } => FakeMethod::Drag,
            PointerEvent::Scroll { .. } => FakeMethod::Scroll,
        };
        self.begin(method)?;
        self.input_gate(target, mode)?;
        let event = RecordedPointer::from(ev);
        if *target == Target::Desktop || mode == DeliveryMode::Foreground {
            self.cursor = self.cursor.and(event.end_point());
        }
        self.deliver_focus(target, mode);
        self.record(SinkOp::Pointer {
            target: target.clone(),
            event,
            mode,
        });
        Ok(())
    }

    fn type_text(&mut self, target: &Target, text: &str, mode: DeliveryMode) -> CoreResult<()> {
        self.begin(FakeMethod::TypeText)?;
        self.input_gate(target, mode)?;
        self.deliver_focus(target, mode);
        self.record(SinkOp::TypeText {
            target: target.clone(),
            text: text.to_string(),
            mode,
        });
        Ok(())
    }

    fn key_chord(&mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode) -> CoreResult<()> {
        self.begin(FakeMethod::KeyChord)?;
        self.input_gate(target, mode)?;
        self.deliver_focus(target, mode);
        self.record(SinkOp::KeyChord {
            target: target.clone(),
            keys: keys.to_vec(),
            mode,
        });
        Ok(())
    }

    fn raise_window(&mut self, id: &str) -> CoreResult<()> {
        self.begin(FakeMethod::RaiseWindow)?;
        self.window(id)?;
        self.focus_window(id);
        self.record(SinkOp::RaiseWindow { id: id.to_string() });
        Ok(())
    }

    fn ax(&mut self) -> Option<&mut dyn AxBackend> {
        if self.capabilities.ax {
            Some(self)
        } else {
            None
        }
    }

    fn release_all(&mut self) -> CoreResult<()> {
        self.begin(FakeMethod::ReleaseAll)?;
        self.record(SinkOp::ReleaseAll);
        Ok(())
    }

    fn cursor_position(&mut self) -> CoreResult<Option<DesktopPoint>> {
        self.begin(FakeMethod::CursorPosition)?;
        Ok(self.cursor)
    }

    fn warp_cursor(&mut self, point: DesktopPoint) -> CoreResult<()> {
        self.begin(FakeMethod::WarpCursor)?;
        self.cursor = self.cursor.and(Some(point));
        self.record(SinkOp::WarpCursor(point));
        Ok(())
    }

    fn front_window(&mut self) -> CoreResult<Option<FrontWindow>> {
        self.begin(FakeMethod::FrontWindow)?;
        self.record(SinkOp::QueryFrontWindow);
        Ok(self
            .windows
            .iter()
            .find(|window| window.focused)
            .map(|window| FrontWindow {
                // The scenario may omit a pid; 0 stands for "unknown process".
                pid: window.pid.unwrap_or(0),
                window_id: Some(window.id.clone()),
                app: window.app.clone(),
                key_window_ax_title: Some(window.title.clone()),
            }))
    }

    fn restore_front_window(&mut self, front: &FrontWindow) -> CoreResult<()> {
        self.begin(FakeMethod::RestoreFrontWindow)?;
        if let Some(id) = &front.window_id {
            self.window(id)?;
            self.focus_window(id);
        }
        self.record(SinkOp::RestoreFrontWindow(front.clone()));
        Ok(())
    }

    fn restore_key_focus(&mut self, front: &FrontWindow) -> CoreResult<()> {
        self.begin(FakeMethod::RestoreKeyFocus)?;
        self.record(SinkOp::RestoreKeyFocus(front.clone()));
        Ok(())
    }

    fn screen_locked(&mut self) -> CoreResult<bool> {
        self.begin(FakeMethod::ScreenLocked)?;
        Ok(self.capabilities.screen_locked)
    }
}
