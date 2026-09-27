//! `Win32Backend`: DPI awareness at construction, capture and enumeration,
//! UI Automation, enigo/`SendInput`/`PostMessageW` input behind the
//! `SetForegroundWindow` focus guard, and the capabilities that report the
//! engine's integrity level and what actually initialized.

use image::RgbaImage;
use senpi_desktop_core::backend::{AxBackend, Backend, DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopPoint, DesktopWindow, DisplaySelector,
    FrontWindow, Target,
};

use crate::ax::Win32Ax;
use crate::capture::{enable_per_monitor_awareness, Win32Capture};
use crate::input::{self, Win32Input};
use crate::integrity::{self, IntegrityRid};

pub struct Win32Backend {
    capture: Win32Capture,
    integrity: IntegrityRid,
    ax: Win32Ax,
    /// Why input is unavailable (enigo failed to initialize) when it is.
    input: Result<Win32Input, DesktopError>,
}

impl Win32Backend {
    /// Enables per-monitor-v2 DPI awareness before any xcap, geometry, or
    /// input call, reads the process integrity label, and validates the
    /// display selector. Input is an optional half: without it the backend
    /// still captures and reports input unavailable.
    ///
    /// # Errors
    /// `CaptureFailed` when DPI awareness or the integrity label is
    /// unavailable or no display is active; `InvalidTarget` when the selected
    /// display id is not active.
    pub fn new(display: DisplaySelector) -> CoreResult<Self> {
        enable_per_monitor_awareness()?;
        let integrity = integrity::current_process().map_err(|error| {
            DesktopError::capture_failed(format!("Win32 process integrity level query failed: {error}"))
        })?;
        let capture = Win32Capture::new(display, integrity);
        capture.displays()?;
        Ok(Self {
            capture,
            integrity,
            ax: Win32Ax::new(),
            input: Win32Input::new(integrity),
        })
    }

    pub fn capabilities(&self) -> DesktopCapabilities {
        let display_count = self
            .capture
            .displays()
            .map_or(0, |displays| u32::try_from(displays.len()).unwrap_or(u32::MAX));
        let input = self.input.is_ok();
        DesktopCapabilities {
            backend: "win32".to_string(),
            display_server: Some("win32".to_string()),
            capture: display_count > 0,
            capture_permission: if display_count > 0 { "granted" } else { "unknown" }.to_string(),
            input,
            background_window_input: input,
            delivery_modes: if input {
                vec!["background".to_string(), "foreground".to_string()]
            } else {
                Vec::new()
            },
            input_permission: if input { "granted" } else { "unavailable" }.to_string(),
            focus_guard: input,
            ax: true,
            ax_permission: "granted".to_string(),
            display_count,
            integrity_level: Some(self.integrity.level().label().to_string()),
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

    fn input(&mut self) -> CoreResult<&mut Win32Input> {
        self.input.as_mut().map_err(|error| error.clone())
    }
}

impl Backend for Win32Backend {
    fn capabilities(&mut self) -> DesktopCapabilities {
        Win32Backend::capabilities(self)
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
        self.input()?.pointer(target, &event, mode)
    }

    fn type_text(&mut self, target: &Target, text: &str, mode: DeliveryMode) -> CoreResult<()> {
        self.input()?.type_text(target, text, mode)
    }

    fn key_chord(&mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode) -> CoreResult<()> {
        self.input()?.key_chord(target, keys, mode)
    }

    fn raise_window(&mut self, id: &str) -> CoreResult<()> {
        input::raise_window(id)
    }

    fn ax(&mut self) -> Option<&mut dyn AxBackend> {
        Some(&mut self.ax)
    }

    /// Without input nothing was ever pressed, so nothing is held.
    fn release_all(&mut self) -> CoreResult<()> {
        self.input.as_mut().map_or(Ok(()), Win32Input::release_all)
    }

    fn cursor_position(&mut self) -> CoreResult<Option<DesktopPoint>> {
        input::cursor_position().map(Some)
    }

    fn warp_cursor(&mut self, point: DesktopPoint) -> CoreResult<()> {
        input::warp_cursor(point)
    }

    fn front_window(&mut self) -> CoreResult<Option<FrontWindow>> {
        let Some((id, pid)) = input::foreground_window_id() else {
            return Ok(None);
        };
        let app = self
            .capture
            .windows()?
            .into_iter()
            .find(|window| window.id == id)
            .map(|window| window.app)
            .unwrap_or_default();
        Ok(Some(FrontWindow {
            pid: pid.unwrap_or(0),
            window_id: Some(id),
            app,
            key_window_ax_title: None,
        }))
    }

    fn restore_front_window(&mut self, front: &FrontWindow) -> CoreResult<()> {
        front.window_id.as_deref().map_or(Ok(()), input::raise_window)
    }
}
