//! The fake backend plus injected panics: the fake itself can only fail a
//! call, and a transaction must also survive a backend that unwinds.

use std::sync::Arc;

use image::RgbaImage;
use parking_lot::Mutex;
use senpi_desktop_backend_fake::{FakeBackend, FakeMethod};
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::backend::{Backend, DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError, PermissionDeniedData, TccPermission};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::menus::MenuItem;
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopPoint, DesktopWindow, FrontWindow, Target,
};

/// Makes the next call of one method panic; clones share the slot.
#[derive(Debug, Clone, Default)]
pub(crate) struct Panics(Arc<Mutex<Option<FakeMethod>>>);

impl Panics {
    pub(crate) fn panic_next(&self, method: FakeMethod) {
        *self.0.lock() = Some(method);
    }

    fn check(&self, method: FakeMethod) {
        let hit = self.0.lock().take_if(|armed| *armed == method).is_some();
        assert!(!hit, "injected {method:?} panic");
    }
}

pub(crate) struct PanickyFake {
    pub(crate) inner: FakeBackend,
    pub(crate) panics: Panics,
}

impl Backend for PanickyFake {
    fn permission_denied(&mut self, permission: TccPermission) -> DesktopError {
        DesktopError::permission_denied_with(PermissionDeniedData {
            permission,
            settings_url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility".to_owned(),
            app: "Marked fake launcher".to_owned(),
            relaunch_required: true,
        }, "backend-enriched permission refusal")
    }

    fn capabilities(&mut self) -> DesktopCapabilities {
        self.inner.capabilities()
    }
    fn displays(&mut self) -> CoreResult<Vec<DesktopDisplay>> {
        self.inner.displays()
    }
    fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>> {
        self.inner.windows()
    }
    fn capture(&mut self, target: &Target, caps: &CaptureCaps) -> CoreResult<(RgbaImage, FrameGeometry)> {
        self.inner.capture(target, caps)
    }
    fn pointer(
        &mut self,
        target: &Target,
        ev: PointerEvent,
        frame: &FrameGeometry,
        mode: DeliveryMode,
    ) -> CoreResult<()> {
        self.inner.pointer(target, ev, frame, mode)
    }
    fn type_text(&mut self, target: &Target, text: &str, mode: DeliveryMode) -> CoreResult<()> {
        self.inner.type_text(target, text, mode)
    }
    fn clipboard_read(&mut self) -> CoreResult<String> {
        self.inner.clipboard_read()
    }
    fn clipboard_write(&mut self, text: &str) -> CoreResult<()> {
        self.inner.clipboard_write(text)
    }
    fn type_text_interruptible(
        &mut self,
        target: &Target,
        text: &str,
        mode: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        self.inner.type_text_interruptible(target, text, mode, check_stop, delivered)
    }
    fn key_chord(&mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode) -> CoreResult<()> {
        self.inner.key_chord(target, keys, mode)
    }
    fn raise_window(&mut self, id: &str) -> CoreResult<()> {
        self.inner.raise_window(id)
    }
    fn menu_items(&mut self, window: &DesktopWindow, path: &[String]) -> CoreResult<Vec<MenuItem>> {
        self.inner.menu_items(window, path)
    }
    fn menu_select(
        &mut self,
        window: &DesktopWindow,
        path: &[String],
        check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<()> {
        self.inner.menu_select(window, path, check_stop)
    }
    fn ax(&mut self) -> Option<&mut dyn AxBackend> {
        self.inner.ax()
    }
    fn release_all(&mut self) -> CoreResult<()> {
        self.panics.check(FakeMethod::ReleaseAll);
        self.inner.release_all()
    }
    fn cursor_position(&mut self) -> CoreResult<Option<DesktopPoint>> {
        self.inner.cursor_position()
    }
    fn warp_cursor(&mut self, point: DesktopPoint) -> CoreResult<()> {
        self.panics.check(FakeMethod::WarpCursor);
        self.inner.warp_cursor(point)
    }
    fn front_window(&mut self) -> CoreResult<Option<FrontWindow>> {
        self.inner.front_window()
    }
    fn restore_front_window(&mut self, front: &FrontWindow) -> CoreResult<()> {
        self.panics.check(FakeMethod::RestoreFrontWindow);
        self.inner.restore_front_window(front)
    }
    fn restore_key_focus(&mut self, front: &FrontWindow) -> CoreResult<()> {
        self.panics.check(FakeMethod::RestoreKeyFocus);
        self.inner.restore_key_focus(front)
    }
    fn screen_locked(&mut self) -> CoreResult<bool> {
        self.inner.screen_locked()
    }
}
