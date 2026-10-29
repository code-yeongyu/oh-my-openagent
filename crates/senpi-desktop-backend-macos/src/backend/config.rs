use image::RgbaImage;
use senpi_desktop_core::error::{CoreResult, TccPermission};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow, DisplaySelector, Target};

use super::MacosBackend;
use crate::ax::is_trusted;
use crate::capture::{MacCapture, Screencapture};
use crate::input::{CanaryMode, CanaryResult, MacInput, UserInputWatch};

impl MacosBackend {
    pub fn new(display: DisplaySelector) -> CoreResult<Self> {
        let overlay = crate::overlay::Overlay::default();
        Ok(Self {
            capture: MacCapture::new(display, Screencapture::system())
                .with_overlay(overlay.clone()),
            input: MacInput::new(CanaryMode::Session)?.with_overlay(overlay.clone()),
            ax: crate::ax::MacAx::with_overlay(overlay.clone()),
            overlay,
            user_input: UserInputWatch::default(),
            reroute: crate::key_reroute::RerouteOwner::default(),
        })
    }

    /// Display-only setting; it does not change delivery mode or control admission.
    pub fn set_show_cursor(&mut self, enabled: bool) {
        self.overlay.configure(enabled);
    }

    pub fn overlay_available(&self) -> bool {
        self.overlay.available()
    }

    pub(super) fn show_typing_target(&self, target: &Target) {
        if !self.overlay.available() {
            return;
        }
        if let Ok(windows) = self.capture.windows() {
            let window = windows.iter().find(|window| match target {
                Target::Desktop | Target::Display(_) => window.focused,
                Target::Window(id) => window.id == *id,
            });
            if let Some(window) = window {
                self.ax.show_typing_target(window);
            }
        }
    }

    /// Applies the `computer.macosCanary` setting (`session` default).
    pub fn set_canary_mode(&mut self, mode: CanaryMode) {
        self.input.configure_canary(mode);
    }

    /// Runs (or re-runs) the SkyLight receipt canary explicitly.
    pub fn canary(&mut self) -> CoreResult<CanaryResult> {
        self.input.canary()
    }

    /// Re-arms a failed canary so background input is retried.
    pub fn resume_canary(&mut self) {
        self.input.rerun_canary();
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

    pub(super) fn require_input_permission() -> CoreResult<()> {
        if is_trusted() {
            Ok(())
        } else {
            Err(super::permissions::permission_denied(
                TccPermission::Accessibility,
            ))
        }
    }
}
