//! `WaylandBackend`: background-only desktop input over libei, AT-SPI
//! accessibility and window listing, and honest capabilities. Wayland lets
//! no client activate or target another surface, so raising and keyboard
//! input aimed at a window are refused with the compositor's constraint, and
//! there is no focus guard. On Hyprland, KWin and GNOME, window-targeted
//! pointer input goes through libei at the window's geometry read from
//! Hyprland IPC, a read-only KWin script or the read-only window-rect GNOME
//! Shell extension (refused elsewhere). Capture streams each monitor through ScreenCast and PipeWire
//! (window capture crops the composite), else uses the Screenshot portal.

use image::RgbaImage;
use senpi_desktop_backend_atspi::{AtSpiAx, AxPermission, WindowIds};
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::backend::{Backend, DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::menus::MenuItem;
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopWindow, DisplaySelector, Target,
    WindowInput,
};

use crate::capture::layout::EisRegion;
use crate::capture::PortalCapture;
use crate::compositor::hyprland::{self, Detection, Placement};
use crate::compositor::{gnome, kwin};
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
    /// Whether this session runs on Hyprland with a reachable IPC socket;
    /// probed once, on the first capabilities or window pointer request.
    pub(crate) compositor: Option<Detection>,
    /// Whether this KDE session's KWin serves its scripting API; probed once,
    /// only off Hyprland.
    pub(crate) kwin: Option<kwin::Detection>,
    /// Whether this GNOME session's shell serves the window-rect extension;
    /// probed once, only off Hyprland and KWin.
    pub(crate) gnome: Option<gnome::Detection>,
    pub(crate) capture: PortalCapture,
    /// The libei layout the last capture's geometry was derived from; pointer
    /// input through a capture frame is refused once it no longer holds.
    frame_layout: Option<Vec<EisRegion>>,
}

impl WaylandBackend {
    /// Read-only construction: removes the orphaned oh-my-pi restore token
    /// and connects AT-SPI, never libei or a portal session.
    pub fn new(selector: DisplaySelector) -> Self {
        token_cleanup::remove_orphaned_remote_desktop_token();
        Self {
            capture: PortalCapture::new(selector),
            ..Self::with_ax(AtSpiAx::new(WindowIds::AtSpiFrames))
        }
    }

    pub(crate) const fn with_ax(ax: Result<AtSpiAx, DesktopError>) -> Self {
        Self {
            ax,
            input: Input::Untried,
            portal_offered: None,
            compositor: None,
            kwin: None,
            gnome: None,
            capture: PortalCapture::new(DisplaySelector::All),
            frame_layout: None,
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
        self.connect_input()
    }

    fn connect_input(&mut self) -> CoreResult<&mut Libei> {
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

    fn compositor(&mut self) -> &Detection {
        self.compositor.get_or_insert_with(hyprland::detect)
    }

    fn kwin(&mut self) -> &kwin::Detection {
        self.kwin.get_or_insert_with(kwin::detect)
    }

    fn gnome(&mut self) -> &gnome::Detection {
        self.gnome.get_or_insert_with(gnome::detect)
    }

    /// The compositor path that can say where a window is: Hyprland first,
    /// else KWin, else GNOME; `Err` carries the reason neither is usable, `Ok(None)`
    /// means no compositor path exists on this desktop.
    fn window_geometry(&mut self) -> Result<Option<WindowGeometry>, &'static str> {
        match self.compositor() {
            Detection::Ipc(hyprland) => return Ok(Some(WindowGeometry::Hyprland(hyprland.clone()))),
            Detection::IpcMissing => return Err("hyprland_ipc_missing"),
            Detection::NotHyprland => {}
        }
        match self.kwin() {
            kwin::Detection::Scripting(kwin) if kwin.unrunnable() => return Err("kwin_script_unrunnable"),
            kwin::Detection::Scripting(kwin) => return Ok(Some(WindowGeometry::Kwin(kwin.clone()))),
            kwin::Detection::DbusMissing => return Err("kwin_dbus_missing"),
            kwin::Detection::NotKwin => {}
        }
        match self.gnome() {
            gnome::Detection::Extension(gnome) => Ok(Some(WindowGeometry::Gnome(gnome.clone()))),
            gnome::Detection::ExtensionMissing => Err("gnome_extension_missing"),
            gnome::Detection::NotGnome => Ok(None),
        }
    }

    /// `None` where no compositor path exists; on Hyprland, KWin or GNOME,
    /// available only when the compositor answers and a libei input path
    /// exists.
    fn window_input(&mut self, input_permission: &str) -> Option<WindowInput> {
        let unavailable = |reason: &str| WindowInput {
            available: false,
            reason: Some(reason.to_owned()),
        };
        match self.window_geometry() {
            Ok(None) => None,
            Err(reason) => Some(unavailable(reason)),
            Ok(Some(_)) if input_permission == "unavailable" => Some(unavailable("no_eis")),
            Ok(Some(_)) => Some(WindowInput {
                available: true,
                reason: None,
            }),
        }
    }

    /// Pointer input at a window, through libei at the window's compositor
    /// geometry; without a compositor path the compositor constraint refuses it.
    fn window_pointer(&mut self, id: &str, event: PointerEvent) -> CoreResult<()> {
        let Ok(Some(geometry)) = self.window_geometry() else {
            return Self::window_input_error(&Target::Window(id.to_owned()), "pointer input");
        };
        let window = self
            .windows()?
            .into_iter()
            .find(|window| window.id == id)
            .ok_or_else(|| DesktopError::window_not_found(format!("window {id} is no longer available")))?;
        match geometry {
            WindowGeometry::Hyprland(hyprland) => self.hyprland_pointer(&hyprland, &window, event),
            WindowGeometry::Kwin(kwin) => self.kwin_pointer(&kwin, &window, event),
            WindowGeometry::Gnome(gnome) => self.gnome_pointer(&gnome, &window, event),
        }
    }

    pub(crate) fn gnome_pointer(
        &mut self,
        gnome: &gnome::Gnome,
        window: &DesktopWindow,
        event: PointerEvent,
    ) -> CoreResult<()> {
        let placement = gnome.placement(window)?;
        self.placed_pointer(&placement, window, event)
    }

    pub(crate) fn kwin_pointer(
        &mut self,
        kwin: &kwin::Kwin,
        window: &DesktopWindow,
        event: PointerEvent,
    ) -> CoreResult<()> {
        let placement = kwin.placement(window)?;
        self.placed_pointer(&placement, window, event)
    }

    /// The event's points are global logical points anchored on the window's
    /// current AT-SPI origin: `FrameGeometry::map_point` re-anchors a window
    /// frame on the window `windows()` lists now, and AX clicks use AT-SPI
    /// coordinates. So that origin is the one subtracted, and the remaining
    /// offset is placed on the Hyprland (or KWin) rect. A window capture crops
    /// at that same rect (see [`WaylandBackend::capture`]), so pixel
    /// `(px, py)` of the frame lands at the rect's origin plus `(px, py)`.
    pub(crate) fn hyprland_pointer(
        &mut self,
        hyprland: &hyprland::Hyprland,
        window: &DesktopWindow,
        event: PointerEvent,
    ) -> CoreResult<()> {
        let placement = hyprland.placement(window)?;
        self.placed_pointer(&placement, window, event)
    }

    /// The compositor that places a window capture: the same
    /// [`WaylandBackend::window_geometry`] dispatch window pointer input is
    /// placed through, so on Hyprland, KWin and GNOME a window frame is cropped
    /// at the rect its clicks land on. Where no compositor path is usable,
    /// window pointer input is refused anyway and the crop stays at AT-SPI.
    pub(crate) fn capture_geometry(&mut self, target: &Target) -> Option<WindowGeometry> {
        match target {
            Target::Window(_) => self.window_geometry().ok().flatten(),
            Target::Desktop | Target::Display(_) => None,
        }
    }

    fn placed_pointer(
        &mut self,
        placement: &Placement,
        window: &DesktopWindow,
        event: PointerEvent,
    ) -> CoreResult<()> {
        let origin = (f64::from(window.x), f64::from(window.y));
        self.connect_input()?
            .window_pointer(event, origin, &placement.rect, &placement.covering)
    }
}

/// The frame of a window capture its compositor could not place: its pixels
/// are shown, but no coordinate input is mapped through them, because a
/// click would be placed at a rect the crop was not taken from.
pub(crate) fn unplaced_frame(
    image: RgbaImage,
    compositor: &str,
    error: &DesktopError,
) -> (RgbaImage, FrameGeometry) {
    let frame = FrameGeometry::pixels_only(
        image.width(),
        image.height(),
        format!(
            "{compositor} could not place this window ({}), so the crop is not known to show where \
             window pointer input would land",
            error.message
        ),
    );
    (image, frame)
}

/// `windows` with the captured window moved onto the rect its compositor
/// places window pointer input at; the refusal names the compositor that
/// could not place it. Display and desktop captures are left alone.
pub(crate) fn place_captured(
    geometry: Option<&WindowGeometry>,
    windows: Vec<DesktopWindow>,
    target: &Target,
) -> (Vec<DesktopWindow>, Option<(&'static str, DesktopError)>) {
    match (geometry, target) {
        (Some(geometry), Target::Window(id)) => {
            let (windows, refused) = match geometry {
                WindowGeometry::Hyprland(hyprland) => hyprland.place_in(windows, id),
                WindowGeometry::Kwin(kwin) => kwin.place_in(windows, id),
                WindowGeometry::Gnome(gnome) => gnome.place_in(windows, id),
            };
            (windows, refused.map(|error| (geometry.compositor(), error)))
        }
        _ => (windows, None),
    }
}

pub(crate) enum WindowGeometry {
    Hyprland(hyprland::Hyprland),
    Kwin(kwin::Kwin),
    Gnome(gnome::Gnome),
}

impl WindowGeometry {
    const fn compositor(&self) -> &'static str {
        match self {
            Self::Hyprland(_) => "Hyprland",
            Self::Kwin(_) => "KWin",
            Self::Gnome(_) => "GNOME",
        }
    }
}

const LAYOUT_CHANGED: &str = "the Wayland display layout changed since the last capture, whose pixels were \
     mapped through the old libei layout; capture again before coordinate input";

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
            window_input: self.window_input(input_permission),
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

    /// Reads the layout of an already connected libei session only; capture
    /// never opens an input session. A layout that cannot be read leaves the
    /// geometry unproven, so the frame refuses coordinate input. On Hyprland
    /// and KWin a window is cropped at its compositor rect (one `clients` +
    /// `monitors` read, or one KWin script run, per capture), the rect window
    /// pointer input is placed at; a window the compositor cannot place gets
    /// a frame that refuses coordinate input.
    fn capture(&mut self, target: &Target, _caps: &CaptureCaps, _exclude_window_titles: &[String]) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let layout = match &mut self.input {
            Input::Connected(libei) => libei.regions().ok(),
            Input::Untried | Input::Failed(_) => None,
        };
        let geometry = self.capture_geometry(target);
        let mut unplaced = None;
        let ax = &mut self.ax;
        let captured = self.capture.capture(target, layout.as_deref(), || {
            let windows = match ax {
                Ok(ax) => ax.windows(),
                Err(error) => Err(error.clone()),
            }?;
            let (windows, refused) = place_captured(geometry.as_ref(), windows, target);
            unplaced = refused;
            Ok(windows)
        })?;
        self.frame_layout = layout.filter(|_| self.capture.eis_derived);
        Ok(match unplaced {
            Some((compositor, error)) => unplaced_frame(captured.0, compositor, &error),
            None => captured,
        })
    }

    fn pointer(
        &mut self,
        target: &Target,
        ev: PointerEvent,
        frame: &FrameGeometry,
        _mode: DeliveryMode,
    ) -> CoreResult<()> {
        let derived_from = self.frame_layout.clone();
        if let Target::Window(id) = target {
            if !matches!(self.window_geometry(), Ok(Some(_))) {
                return Self::window_input_error(target, "pointer input");
            }
            if let Some(layout) = derived_from.filter(|_| *frame != FrameGeometry::identity_global()) {
                if self.connect_input()?.regions()? != layout {
                    return Err(DesktopError::invalid_coordinate_frame(LAYOUT_CHANGED));
                }
            }
            return self.window_pointer(id, ev);
        }
        let libei = self.prepare_input(target, "pointer input")?;
        if let Some(layout) = derived_from.filter(|_| *frame != FrameGeometry::identity_global()) {
            if libei.regions()? != layout {
                return Err(DesktopError::invalid_coordinate_frame(LAYOUT_CHANGED));
            }
        }
        libei.pointer(ev)
    }

    fn type_text(&mut self, target: &Target, text: &str, _mode: DeliveryMode) -> CoreResult<()> {
        self.prepare_input(target, "keyboard input")?.type_text(text)
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
        _mode: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        self.prepare_input(target, "keyboard input")?.type_text_interruptible(text, check_stop, delivered)
    }

    fn key_chord(&mut self, target: &Target, keys: &[KeyName], _mode: DeliveryMode) -> CoreResult<()> {
        self.prepare_input(target, "keyboard input")?.key_chord(keys)
    }
    fn hold_keys(
        &mut self, target: &Target, keys: &[KeyName], _mode: DeliveryMode,
        control: &senpi_desktop_core::holds::HoldControl<'_>,
    ) -> CoreResult<()> {
        self.prepare_input(target, "bounded keyboard input")?.hold_keys(keys, control)
    }
    fn hold_mouse(
        &mut self, target: &Target, hold: &senpi_desktop_core::holds::MouseHold<'_>,
        _mode: DeliveryMode, control: &senpi_desktop_core::holds::HoldControl<'_>,
    ) -> CoreResult<()> {
        let layout = self.frame_layout.clone();
        let libei = self.prepare_input(target, "bounded pointer input")?;
        if let Some(layout) = layout {
            if libei.regions()? != layout {
                return Err(DesktopError::invalid_coordinate_frame(LAYOUT_CHANGED));
            }
        }
        libei.hold_mouse(hold, control)
    }

    fn raise_window(&mut self, id: &str) -> CoreResult<()> {
        Err(DesktopError::background_unavailable(format!(
            "window {id} wayland-compositor-focus-only: Wayland cannot programmatically activate a \
             non-focused window; only the currently focused surface is reachable"
        )))
    }

    fn menu_items(&mut self, window: &DesktopWindow, path: &[String]) -> CoreResult<Vec<MenuItem>> {
        match &mut self.ax {
            Ok(ax) => ax.menu_items(window, &[], path),
            Err(error) => Err(error.clone()),
        }
    }

    /// The command runs through its own AT-SPI action, which needs no focus,
    /// so it reaches a non-focused surface Wayland input cannot target.
    fn menu_select(
        &mut self,
        window: &DesktopWindow,
        path: &[String],
        _delivery: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<()> {
        match &mut self.ax {
            Ok(ax) => ax.menu_select(window, &[], &|| Ok(Vec::new()), path, check_stop),
            Err(error) => Err(error.clone()),
        }
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
mod eis_safety_tests;
#[cfg(test)]
mod eis_tests;
#[cfg(test)]
mod gnome_tests;
#[cfg(test)]
mod hyprland_tests;
#[cfg(test)]
mod kwin_tests;
#[cfg(test)]
mod layout_tests;
#[cfg(test)]
mod portal_tests;
#[cfg(test)]
mod tests;
