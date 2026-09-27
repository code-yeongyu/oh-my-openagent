//! `X11Backend`: capture and enumeration, XTEST/`XSendEvent` input with the
//! `_NET_ACTIVE_WINDOW` focus guard, and AT-SPI accessibility, with
//! capabilities measured from what actually connected.

use image::RgbaImage;
use senpi_desktop_backend_atspi::{AtSpiAx, AxPermission};
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::backend::{Backend, DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopPoint, DesktopWindow, DisplaySelector,
    FrontWindow, Target,
};

use crate::capture::{X11Capture, X11Connection, XServer};
use crate::input::{InputServer, X11Input, X11InputConnection};

pub struct X11Backend<S = X11Connection, I = X11InputConnection> {
    capture: X11Capture<S>,
    /// Why input is unavailable (no XTEST) when it is.
    input: Result<X11Input<I>, DesktopError>,
    ax: Option<AtSpiAx>,
    display_server: Option<String>,
}

impl X11Backend<X11Connection, X11InputConnection> {
    /// Connects to the X server named by `DISPLAY`. Input and AT-SPI are
    /// optional halves: without XTEST or an accessibility bus the backend
    /// still captures and reports them unavailable.
    ///
    /// # Errors
    /// `CaptureFailed` when the server is unreachable or its root unreadable.
    pub fn new(selector: DisplaySelector) -> CoreResult<Self> {
        Ok(Self {
            capture: X11Capture::new(selector)?,
            input: X11Input::connect(),
            ax: AtSpiAx::new().ok(),
            display_server: std::env::var("DISPLAY").ok(),
        })
    }
}

impl<S: XServer, I: InputServer> X11Backend<S, I> {
    #[cfg(test)]
    pub(crate) fn with_parts(
        capture: X11Capture<S>,
        input: Result<X11Input<I>, DesktopError>,
        display_server: Option<String>,
    ) -> Self {
        Self {
            capture,
            input,
            ax: None,
            display_server,
        }
    }

    #[cfg(test)]
    pub(crate) fn input_ref(&self) -> Option<&X11Input<I>> {
        self.input.as_ref().ok()
    }

    /// Capture truth from a live RandR query, input truth from the XTEST
    /// gate, AX truth from the accessibility registry.
    pub fn capabilities(&mut self) -> DesktopCapabilities {
        let displays = self.capture.displays();
        let capture = displays.is_ok();
        let input = self.input.as_ref().ok();
        let ax = AxPermission::of(self.ax.as_mut());
        DesktopCapabilities {
            backend: "x11".to_string(),
            display_server: self.display_server.clone(),
            capture,
            input: input.is_some(),
            ax: ax.is_granted(),
            background_window_input: input.is_some(),
            delivery_modes: if input.is_some() {
                vec!["background".to_string(), "foreground".to_string()]
            } else {
                Vec::new()
            },
            capture_permission: granted(capture).to_string(),
            input_permission: granted(input.is_some()).to_string(),
            ax_permission: ax.as_str().to_string(),
            display_count: displays.map_or(0, |items| u32::try_from(items.len()).unwrap_or(u32::MAX)),
            focus_guard: input.is_some_and(X11Input::focus_guard_available),
            ..DesktopCapabilities::unavailable()
        }
    }

    fn input(&mut self) -> CoreResult<&mut X11Input<I>> {
        self.input.as_mut().map_err(|error| error.clone())
    }

    fn window(&self, id: &str) -> CoreResult<DesktopWindow> {
        self.capture
            .windows()?
            .into_iter()
            .find(|window| window.id == id)
            .ok_or_else(|| {
                DesktopError::window_not_found(format!(
                    "window '{id}' was not found; it may be closed or unmapped"
                ))
            })
    }
}

const fn granted(granted: bool) -> &'static str {
    if granted {
        "granted"
    } else {
        "unavailable"
    }
}

impl<S: XServer + Send, I: InputServer + Send> Backend for X11Backend<S, I> {
    fn capabilities(&mut self) -> DesktopCapabilities {
        X11Backend::capabilities(self)
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
        self.window(id)?;
        self.input()?.raise_window(id)
    }

    fn ax(&mut self) -> Option<&mut dyn AxBackend> {
        self.ax.as_mut().map(|ax| ax as &mut dyn AxBackend)
    }

    /// Without input nothing was ever pressed, so nothing is held.
    fn release_all(&mut self) -> CoreResult<()> {
        self.input.as_mut().map_or(Ok(()), X11Input::release_all)
    }

    fn cursor_position(&mut self) -> CoreResult<Option<DesktopPoint>> {
        self.input
            .as_ref()
            .ok()
            .map(X11Input::cursor_position)
            .transpose()
    }

    fn warp_cursor(&mut self, point: DesktopPoint) -> CoreResult<()> {
        self.input()?.warp_cursor(point)
    }

    fn front_window(&mut self) -> CoreResult<Option<FrontWindow>> {
        let Some(active) = self.input.as_ref().ok().and_then(X11Input::active_window) else {
            return Ok(None);
        };
        let id = active.to_string();
        let window = self.capture.windows()?.into_iter().find(|window| window.id == id);
        Ok(Some(FrontWindow {
            pid: window.as_ref().and_then(|window| window.pid).unwrap_or(0),
            app: window.map(|window| window.app).unwrap_or_default(),
            window_id: Some(id),
            key_window_ax_title: None,
        }))
    }

    fn restore_front_window(&mut self, front: &FrontWindow) -> CoreResult<()> {
        match &front.window_id {
            Some(id) => self.input()?.raise_window(id),
            None => Ok(()),
        }
    }
}
