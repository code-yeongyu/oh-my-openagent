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
    fn capture(
        &mut self,
        target: &Target,
        _caps: &CaptureCaps,
        _exclude_window_titles: &[String],
    ) -> CoreResult<(RgbaImage, FrameGeometry)> {
        self.begin(FakeMethod::Capture)?;
        if !self.capabilities.capture {
            return Err(DesktopError::capture_failed(
                "capture is unavailable in this fake scenario",
            ));
        }
        let (frame, width, height) = self.frame(target)?;
        let frame = if self.legacy_capture {
            frame.into_legacy_capture()
        } else {
            frame
        };
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
        if matches!(target, Target::Desktop | Target::Display(_)) || mode == DeliveryMode::Foreground {
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

    fn clipboard_read(&mut self) -> CoreResult<String> {
        self.begin(FakeMethod::ClipboardRead)?;
        Ok(self.clipboard.clone())
    }

    fn clipboard_write(&mut self, text: &str) -> CoreResult<()> {
        self.begin(FakeMethod::ClipboardWrite)?;
        self.clipboard.clear();
        self.clipboard.push_str(text);
        self.record(SinkOp::ClipboardWrite {
            text: text.to_owned(),
        });
        Ok(())
    }

    fn type_text_interruptible(
        &mut self,
        target: &Target,
        text: &str,
        mode: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        let mut start = 0;
        for end in text
            .char_indices()
            .map(|(index, _)| index)
            .skip(8)
            .step_by(8)
            .chain(std::iter::once(text.len()))
        {
            check_stop()?;
            self.type_text(target, &text[start..end], mode)?;
            for _ in text[start..end].chars() {
                delivered();
            }
            start = end;
        }
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

    fn hold_keys(
        &mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode,
        control: &senpi_desktop_core::holds::HoldControl<'_>,
    ) -> CoreResult<()> {
        self.hold_keys_impl(target, keys, mode, control)
    }

    fn hold_mouse(
        &mut self, target: &Target, hold: &senpi_desktop_core::holds::MouseHold<'_>,
        mode: DeliveryMode, control: &senpi_desktop_core::holds::HoldControl<'_>,
    ) -> CoreResult<()> {
        self.hold_mouse_impl(target, hold, mode, control)
    }

    fn menu_items(
        &mut self,
        window: &DesktopWindow,
        path: &[String],
    ) -> CoreResult<Vec<senpi_desktop_core::menus::MenuItem>> {
        self.menu_items_impl(window, path)
    }

    fn menu_select(
        &mut self,
        window: &DesktopWindow,
        path: &[String],
        delivery: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<()> {
        self.menu_select_impl(window, path, delivery, check_stop)
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
        self.sink.release_held();
        self.record(SinkOp::ReleaseAll);
        Ok(())
    }

    fn emergency_release(&self) -> Option<std::sync::Arc<dyn senpi_desktop_core::backend::EmergencyRelease>> {
        Some(std::sync::Arc::new(self.sink.clone()))
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
