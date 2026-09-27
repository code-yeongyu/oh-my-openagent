//! `WaylandBackend`: background-only desktop input over libei, AT-SPI
//! accessibility and window listing, and honest capabilities. Wayland lets
//! no client activate or target another surface, so window-targeted input
//! and raising are refused with the compositor's constraint, and there is no
//! focus guard. Capture streams each monitor through ScreenCast and PipeWire
//! (window capture crops the composite), else uses the Screenshot portal.

use image::RgbaImage;
use senpi_desktop_backend_atspi::{AtSpiAx, AxPermission};
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::backend::{Backend, DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopWindow, DisplaySelector, Target,
};

use crate::capture::PortalCapture;
use crate::input::Libei;
use crate::portal::{portal_runtime, remote_desktop, token_cleanup};

/// The libei connection, made on the first desktop input and never retried
/// after it fails (oh-my-pi mod.rs:142-155).
enum Input {
    Untried,
    Connected(Box<Libei>),
    Failed(DesktopError),
}

pub struct WaylandBackend {
    ax: Result<AtSpiAx, DesktopError>,
    input: Input,
    /// Whether the session bus offers the RemoteDesktop portal; probed once,
    /// only while no libei connection was tried.
    portal_offered: Option<bool>,
    pub(crate) capture: PortalCapture,
}

impl WaylandBackend {
    /// Read-only construction: removes the orphaned oh-my-pi restore token
    /// and connects AT-SPI, never libei or a portal session.
    pub fn new(selector: DisplaySelector) -> Self {
        token_cleanup::remove_orphaned_remote_desktop_token();
        Self {
            capture: PortalCapture::new(selector),
            ..Self::with_ax(AtSpiAx::new())
        }
    }

    pub(crate) const fn with_ax(ax: Result<AtSpiAx, DesktopError>) -> Self {
        Self {
            ax,
            input: Input::Untried,
            portal_offered: None,
            capture: PortalCapture::new(DisplaySelector::All),
        }
    }

    fn window_input_error(target: &Target, kind: &str) -> CoreResult<()> {
        if let Target::Window(id) = target {
            return Err(DesktopError::background_unavailable(format!(
                "window {id} wayland-compositor-focus-only: Wayland cannot programmatically activate \
                 a non-focused window for {kind}; only the currently focused surface is reachable; \
                 use ax actions or desktop input"
            )));
        }
        Ok(())
    }

    fn prepare_input(&mut self, target: &Target, kind: &str) -> CoreResult<&mut Libei> {
        Self::window_input_error(target, kind)?;
        if matches!(self.input, Input::Untried) {
            self.input = match Libei::connect() {
                Ok(libei) => Input::Connected(Box::new(libei)),
                Err(error) => Input::Failed(error),
            };
        }
        match &mut self.input {
            Input::Connected(libei) => Ok(libei),
            Input::Failed(error) => Err(error.clone()),
            Input::Untried => Err(DesktopError::input_failed(remote_desktop::INPUT_PATH_REQUIRED)),
        }
    }

    /// `granted` once connected, `unavailable` after a failed connect or
    /// when neither `LIBEI_SOCKET` nor the RemoteDesktop portal exists, else
    /// `prompt-or-granted` (the compositor may still ask).
    fn input_permission(&mut self) -> &'static str {
        match self.input {
            Input::Connected(_) => "granted",
            Input::Failed(_) => "unavailable",
            Input::Untried if std::env::var_os("LIBEI_SOCKET").is_some() => "prompt-or-granted",
            Input::Untried => {
                let offered = *self
                    .portal_offered
                    .get_or_insert_with(|| portal_runtime().is_ok_and(remote_desktop::is_offered));
                if offered {
                    "prompt-or-granted"
                } else {
                    "unavailable"
                }
            }
        }
    }
}

impl Backend for WaylandBackend {
    fn capabilities(&mut self) -> DesktopCapabilities {
        let input_permission = self.input_permission();
        let ax_permission = AxPermission::of(self.ax.as_mut().ok());
        let capture_permission = self.capture.permission();
        DesktopCapabilities {
            backend: "wayland".to_owned(),
            display_server: Some("wayland".to_owned()),
            capture: self.capture.is_proven(),
            input: input_permission != "unavailable",
            ax: ax_permission.is_granted(),
            background_window_input: false,
            delivery_modes: vec!["background".to_owned()],
            capture_permission: capture_permission.to_owned(),
            input_permission: input_permission.to_owned(),
            ax_permission: ax_permission.as_str().to_owned(),
            display_count: u32::try_from(self.capture.displays().len()).unwrap_or(u32::MAX),
            ..DesktopCapabilities::unavailable()
        }
    }

    fn displays(&mut self) -> CoreResult<Vec<DesktopDisplay>> {
        Ok(self.capture.displays())
    }

    fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>> {
        match &mut self.ax {
            Ok(ax) => ax.windows(),
            Err(error) => Err(error.clone()),
        }
    }

    fn capture(&mut self, target: &Target, _caps: &CaptureCaps) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let ax = &mut self.ax;
        self.capture.capture(target, || match ax {
            Ok(ax) => ax.windows(),
            Err(error) => Err(error.clone()),
        })
    }

    fn pointer(
        &mut self,
        target: &Target,
        ev: PointerEvent,
        _frame: &FrameGeometry,
        _mode: DeliveryMode,
    ) -> CoreResult<()> {
        self.prepare_input(target, "pointer input")?.pointer(ev)
    }

    fn type_text(&mut self, target: &Target, text: &str, _mode: DeliveryMode) -> CoreResult<()> {
        self.prepare_input(target, "keyboard input")?.type_text(text)
    }

    fn key_chord(&mut self, target: &Target, keys: &[KeyName], _mode: DeliveryMode) -> CoreResult<()> {
        self.prepare_input(target, "keyboard input")?.key_chord(keys)
    }

    fn raise_window(&mut self, id: &str) -> CoreResult<()> {
        Err(DesktopError::background_unavailable(format!(
            "window {id} wayland-compositor-focus-only: Wayland cannot programmatically activate a \
             non-focused window; only the currently focused surface is reachable"
        )))
    }

    fn ax(&mut self) -> Option<&mut dyn AxBackend> {
        self.ax.as_mut().ok().map(|ax| ax as &mut dyn AxBackend)
    }

    /// Lifts whatever libei still holds; nothing to do before a connection.
    fn release_all(&mut self) -> CoreResult<()> {
        match &mut self.input {
            Input::Connected(libei) => libei.release_all(),
            Input::Untried | Input::Failed(_) => Ok(()),
        }
    }
}

#[cfg(test)]
mod capture_tests;
#[cfg(test)]
mod eis_tests;
#[cfg(test)]
mod portal_tests;
#[cfg(test)]
mod tests;
