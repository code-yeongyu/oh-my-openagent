//! `MacosBackend`: capture, enumeration, input with the focus guard, and the
//! runtime capabilities that report the SkyLight/canary truth.

use image::RgbaImage;
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::backend::{Backend, DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopPoint, DesktopWindow, DisplaySelector,
    FrontWindow, Target,
};

use crate::ax::{is_trusted, MacAx};
use crate::capture::{MacCapture, Screencapture};
use crate::input::{CanaryMode, CanaryResult, MacInput, CANARY_STOP_REASON};

pub struct MacosBackend {
    capture: MacCapture,
    input: MacInput,
    ax: MacAx,
}

impl MacosBackend {
    pub fn new(display: DisplaySelector) -> CoreResult<Self> {
        Ok(Self {
            capture: MacCapture::new(display, Screencapture::system()),
            input: MacInput::new(CanaryMode::Session)?,
            ax: MacAx::new(),
        })
    }

    /// Applies the `computer.macosCanary` setting (`session` default).
    pub fn set_canary_mode(&mut self, mode: CanaryMode) {
        self.input.configure_canary(mode);
    }

    /// Runs (or re-runs) the SkyLight receipt canary explicitly.
    pub fn canary(&mut self) -> CoreResult<CanaryResult> {
        self.input.canary()
    }

    /// Re-arms a failed canary so background input is retried (the
    /// `/computer resume` path).
    pub fn resume_canary(&mut self) {
        self.input.rerun_canary();
    }

    /// Runtime truth from the TCC preflights and the SkyLight probe; never
    /// prompts and never pops the canary dialog.
    pub fn capabilities(&self) -> DesktopCapabilities {
        let capture_permission = self.capture.permission_granted();
        let trusted = is_trusted();
        let display_count = if capture_permission {
            self.capture
                .displays()
                .map_or(0, |displays| u32::try_from(displays.len()).unwrap_or(u32::MAX))
        } else {
            0
        };
        let canary_failed = self.input.canary_failed();
        DesktopCapabilities {
            backend: "quartz".to_string(),
            display_server: Some("Quartz WindowServer".to_string()),
            capture: capture_permission && display_count > 0,
            input: trusted,
            ax: trusted,
            background_window_input: trusted && crate::skylight::is_available() && !canary_failed,
            delivery_modes: vec!["background".to_string(), "foreground".to_string()],
            capture_permission: permission_label(capture_permission),
            input_permission: permission_label(trusted),
            ax_permission: permission_label(trusted),
            display_count,
            focus_guard: true,
            stop_reason: canary_failed.then(|| CANARY_STOP_REASON.to_string()),
            ..DesktopCapabilities::unavailable()
        }
    }

    pub fn displays(&self) -> CoreResult<Vec<DesktopDisplay>> {
        self.capture.displays()
    }

    pub fn windows(&self) -> CoreResult<Vec<DesktopWindow>> {
        self.capture.windows()
    }

    pub fn capture(&self, target: &Target) -> CoreResult<(RgbaImage, FrameGeometry)> {
        self.capture.capture(target)
    }

    fn require_input_permission() -> CoreResult<()> {
        if is_trusted() {
            Ok(())
        } else {
            Err(DesktopError::permission_denied(
                "macOS Accessibility permission is required for native input",
            ))
        }
    }
}

impl Backend for MacosBackend {
    fn capabilities(&mut self) -> DesktopCapabilities {
        MacosBackend::capabilities(self)
    }

    fn displays(&mut self) -> CoreResult<Vec<DesktopDisplay>> {
        self.capture.displays()
    }

    fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>> {
        self.capture.windows()
    }

    fn capture(&mut self, target: &Target, _caps: &CaptureCaps) -> CoreResult<(RgbaImage, FrameGeometry)> {
        self.capture.capture(target)
    }

    fn pointer(
        &mut self,
        target: &Target,
        event: PointerEvent,
        _frame: &FrameGeometry,
        mode: DeliveryMode,
    ) -> CoreResult<()> {
        Self::require_input_permission()?;
        self.input.pointer(target, event, mode, &self.capture)
    }

    fn type_text(&mut self, target: &Target, text: &str, mode: DeliveryMode) -> CoreResult<()> {
        Self::require_input_permission()?;
        self.input.type_text(target, text, mode, &self.capture)
    }

    fn key_chord(&mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode) -> CoreResult<()> {
        Self::require_input_permission()?;
        self.input.key_chord(target, keys, mode, &self.capture)
    }

    fn raise_window(&mut self, id: &str) -> CoreResult<()> {
        Self::require_input_permission()?;
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

    fn ax(&mut self) -> Option<&mut dyn AxBackend> {
        Some(&mut self.ax)
    }

    fn release_all(&mut self) -> CoreResult<()> {
        self.input.release_all()
    }

    fn cursor_position(&mut self) -> CoreResult<Option<DesktopPoint>> {
        self.input.cursor_position()
    }

    fn warp_cursor(&mut self, point: DesktopPoint) -> CoreResult<()> {
        self.input.warp_cursor(point)
    }

    fn front_window(&mut self) -> CoreResult<Option<FrontWindow>> {
        crate::focus::front_window()
    }

    fn restore_front_window(&mut self, front: &FrontWindow) -> CoreResult<()> {
        crate::focus::restore_front_window(front)
    }

    fn restore_key_focus(&mut self, front: &FrontWindow) -> CoreResult<()> {
        crate::focus::restore_key_focus(&mut self.input, front)
    }

    fn screen_locked(&mut self) -> CoreResult<bool> {
        crate::cursor::screen_locked()
    }
}

fn permission_label(granted: bool) -> String {
    if granted { "granted" } else { "denied" }.to_string()
}
