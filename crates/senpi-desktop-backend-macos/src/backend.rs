//! `MacosBackend`: capture, enumeration, input with the focus guard, and the
//! runtime capabilities that report the SkyLight/canary truth.

use image::RgbaImage;
use senpi_desktop_core::ax::{AxBackend, AxHandle};
use senpi_desktop_core::backend::{Backend, DeliveryMode, ElementDelivery, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError, TccPermission};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::menus::MenuItem;
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopPoint, DesktopWindow, DisplaySelector,
    FrontWindow, Target,
};
use senpi_desktop_core::user_input::UserPresses;

use crate::ax::{is_trusted, MacAx};
use crate::capture::{MacCapture, Screencapture};
use crate::input::{CanaryMode, CanaryResult, MacInput, RawFeed, UserInputWatch};

mod capabilities;
mod raise;

#[path = "permissions.rs"]
pub(crate) mod permissions;

pub struct MacosBackend {
    capture: MacCapture,
    input: MacInput,
    ax: MacAx,
    overlay: crate::overlay::Overlay,
    screen: std::sync::Arc<crate::screen::MacScreen>,
    user_input: UserInputWatch,
    /// The watch's feed shared by the session and key priming, once started.
    raw_feed: Option<std::sync::Arc<RawFeed>>,
}

impl MacosBackend {
    pub fn new(display: DisplaySelector) -> CoreResult<Self> {
        let overlay = crate::overlay::Overlay::default();
        Ok(Self {
            screen: std::sync::Arc::new(crate::screen::MacScreen::new(display.clone())),
            capture: MacCapture::new(display, Screencapture::system()).with_overlay(overlay.clone()),
            input: MacInput::new(CanaryMode::Session)?.with_overlay(overlay.clone()),
            ax: MacAx::with_overlay(overlay.clone()),
            overlay,
            user_input: UserInputWatch::default(),
            raw_feed: None,
        })
    }

    /// Display-only setting; it does not change delivery mode or control admission.
    pub fn set_show_cursor(&mut self, enabled: bool) {
        self.overlay.configure(enabled);
    }

    pub fn overlay_available(&self) -> bool {
        self.overlay.available()
    }

    fn show_typing_target(&self, target: &Target) {
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

    /// Re-arms a failed canary so background input is retried (the
    /// `/computer resume` path).
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

    fn require_input_permission() -> CoreResult<()> {
        if is_trusted() {
            Ok(())
        } else {
            Err(permissions::permission_denied(TccPermission::Accessibility))
        }
    }
}

impl Backend for MacosBackend {
    fn emergency_release(&self) -> Option<std::sync::Arc<dyn senpi_desktop_core::backend::EmergencyRelease>> {
        Some(self.input.emergency_release())
    }

    fn permission_denied(&mut self, permission: TccPermission) -> DesktopError {
        permissions::permission_denied(permission)
    }

    fn capabilities(&mut self) -> DesktopCapabilities {
        MacosBackend::capabilities(self)
    }

    fn hit_at(&mut self, x: f64, y: f64) -> CoreResult<Option<senpi_desktop_core::frame::PointHit>> {
        crate::ax::element::hit_at(x, y)
    }

    fn set_show_cursor(&mut self, enabled: bool) {
        MacosBackend::set_show_cursor(self, enabled);
    }

    fn set_key_priming(&mut self, mode: senpi_desktop_core::types::KeyPriming) {
        crate::input::set_key_priming(mode);
    }

    fn set_report_mode(&mut self, mode: senpi_desktop_core::report::ReportMode) {
        crate::input::set_key_report_mode(mode);
    }

    fn displays(&mut self) -> CoreResult<Vec<DesktopDisplay>> {
        self.capture.all_displays()
    }

    fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>> {
        self.capture.windows()
    }

    fn capture(
        &mut self,
        target: &Target,
        _caps: &CaptureCaps,
        exclude_window_titles: &[String],
    ) -> CoreResult<(RgbaImage, FrameGeometry)> {
        self.capture.capture_with_exclusions(target, exclude_window_titles)
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
        self.show_typing_target(target);
        self.input.type_text(target, text, mode, &self.capture)
    }

    fn clipboard_read(&mut self) -> CoreResult<String> {
        senpi_desktop_core::clipboard::read_text()
    }

    fn clipboard_write(&mut self, text: &str) -> CoreResult<()> {
        senpi_desktop_core::clipboard::write_text(text)
    }

    fn type_text_interruptible(
        &mut self,
        target: &Target,
        text: &str,
        mode: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        Self::require_input_permission()?;
        self.show_typing_target(target);
        self.input.type_text_interruptible(target, text, mode, &self.capture, check_stop, delivered)
    }

    fn ax_type_text(
        &mut self,
        h: &AxHandle,
        text: &str,
        mode: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<ElementDelivery> {
        Self::require_input_permission()?;
        self.ax.show_target(h);
        let element = crate::ax::element::element(h)?;
        self.input.ax_type_text(element, text, mode, &self.capture, check_stop, delivered)
    }

    fn key_chord(&mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode) -> CoreResult<()> {
        self.key_chord_interruptible(target, keys, mode, &|| Ok(()))
    }

    fn key_chord_interruptible(
        &mut self,
        target: &Target,
        keys: &[KeyName],
        mode: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<()> {
        Self::require_input_permission()?;
        self.show_typing_target(target);
        self.input.key_chord(target, keys, mode, &self.capture, check_stop)
    }

    fn hold_keys(
        &mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode,
        control: &senpi_desktop_core::holds::HoldControl<'_>,
    ) -> CoreResult<()> {
        Self::require_input_permission()?;
        self.input.hold_keys(target, keys, mode, &self.capture, control)
    }

    fn hold_mouse(
        &mut self, target: &Target, hold: &senpi_desktop_core::holds::MouseHold<'_>,
        mode: DeliveryMode, control: &senpi_desktop_core::holds::HoldControl<'_>,
    ) -> CoreResult<()> {
        Self::require_input_permission()?;
        self.input.hold_mouse(target, hold, mode, &self.capture, control)
    }

    fn menu_items(&mut self, window: &DesktopWindow, path: &[String]) -> CoreResult<Vec<MenuItem>> {
        Self::require_input_permission()?;
        crate::ax::menus::items(window, path)
    }

    fn menu_select(
        &mut self,
        window: &DesktopWindow,
        path: &[String],
        delivery: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<()> {
        Self::require_input_permission()?;
        let (input, capture) = (&mut self.input, &self.capture);
        match delivery {
            DeliveryMode::Background => crate::skylight::reporting_partial(|| {
                crate::ax::menus::select(window, path, check_stop, &mut || {
                    input.make_menu_window_key(window, capture)
                })
            }),
            // The window is already key inside the foreground scope, so `make_key` only verifies it.
            DeliveryMode::Foreground => {
                crate::ax::menus::preflight(window, path, check_stop)?;
                input.with_menu_window_foreground(window, || {
                    crate::ax::menus::select(window, path, check_stop, &mut || Ok(()))
                })
            }
        }
    }

    fn raise_window(&mut self, id: &str) -> CoreResult<()> {
        Self::require_input_permission()?;
        self.raise(id)
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

    fn hold_display_awake(&mut self) -> Option<senpi_desktop_core::backend::DisplayAwakeHold> {
        crate::power::hold_display_awake()
    }

    fn screen_probe(&self) -> Option<std::sync::Arc<dyn senpi_desktop_core::backend::ScreenProbe>> {
        Some(self.screen.clone())
    }

    fn epoch_source(&self) -> Option<std::sync::Arc<dyn senpi_desktop_core::backend::EpochSource>> {
        Some(crate::epoch_sources::MacEpochs::new())
    }

    fn watch_user_input(&mut self) {
        self.user_input.start();
        if self.raw_feed.is_none() {
            if let Some(feed) = self.user_input.feed() {
                let raw = std::sync::Arc::new(RawFeed::new(feed));
                self.input.set_raw_feed(std::sync::Arc::clone(&raw));
                self.raw_feed = Some(raw);
            }
        }
    }

    fn take_user_presses(&mut self) -> UserPresses {
        // Presses key priming already drained wait in the raw feed.
        match &self.raw_feed {
            Some(raw) => senpi_desktop_core::user_input::UserInputFeed::take(&**raw),
            None => self.user_input.take(),
        }
    }

    fn user_input_feed(&mut self) -> Option<std::sync::Arc<dyn senpi_desktop_core::user_input::UserInputFeed>> {
        match &self.raw_feed {
            Some(raw) => Some(std::sync::Arc::clone(raw) as std::sync::Arc<dyn senpi_desktop_core::user_input::UserInputFeed>),
            None => self.user_input.feed(),
        }
    }
}
