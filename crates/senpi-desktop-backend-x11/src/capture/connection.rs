//! The X server seam: the handful of requests capture and enumeration need,
//! behind `XServer` so the layout, filtering and pixel logic is unit-tested
//! against an in-memory server. `X11Connection` is the pure-Rust x11rb
//! implementation (no libX11/libxcb link).

use senpi_desktop_core::error::{CoreResult, DesktopError};
use x11rb::connection::Connection;
use x11rb::errors::ReplyError;
use x11rb::protocol::randr::ConnectionExt as _;
use x11rb::protocol::xproto::{
    Atom, ConnectionExt as _, ImageFormat, ImageOrder, MapState, VisualClass, Window,
};
use x11rb::protocol::ErrorKind;
use x11rb::rust_connection::RustConnection;

use super::image::{ColorMasks, Pixmap, RootRect};

/// Longest property read, in 32-bit units (16 KiB).
const PROPERTY_WORDS: u32 = 4096;

/// The default screen's root window and TrueColor visual.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Screen {
    pub root: Window,
    pub width: u32,
    pub height: u32,
    pub masks: ColorMasks,
}

/// One active RandR monitor; `name` falls back to `Monitor <atom>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Monitor {
    pub atom: Atom,
    pub name: String,
    pub x: i16,
    pub y: i16,
    pub width: u16,
    pub height: u16,
    pub primary: bool,
}

/// Where a client window sits in root coordinates, and whether it is mapped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub viewable: bool,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub trait XServer {
    fn screen(&self) -> Screen;
    /// Active RandR monitors, in server order.
    fn monitors(&self) -> CoreResult<Vec<Monitor>>;
    fn atom(&self, name: &str) -> CoreResult<Atom>;
    /// Format-32 property values; `None` when absent, empty, or not format 32.
    fn words(&self, window: Window, property: Atom, kind: Atom) -> Option<Vec<u32>>;
    /// Raw property bytes; `None` when absent or empty.
    fn bytes(&self, window: Window, property: Atom, kind: Atom) -> Option<Vec<u8>>;
    /// `None` when the window vanished between enumeration and the query.
    fn placement(&self, window: Window) -> Option<Placement>;
    /// `GetImage(ZPixmap)` of a root-window rectangle.
    fn root_image(&self, rect: RootRect) -> CoreResult<Pixmap>;
}

pub struct X11Connection {
    conn: RustConnection,
    screen: Screen,
}

impl X11Connection {
    /// Connects through `DISPLAY` and requires a TrueColor root visual.
    ///
    /// # Errors
    /// `CaptureFailed` when the server is unreachable or the visual is not
    /// TrueColor.
    pub fn connect() -> CoreResult<Self> {
        let (conn, screen_num) = x11rb::connect(None).map_err(|error| {
            DesktopError::capture_failed(format!(
                "X11 connection failed; ensure DISPLAY points at a reachable X server: {error}"
            ))
        })?;
        let screen = conn
            .setup()
            .roots
            .get(screen_num)
            .ok_or_else(|| DesktopError::capture_failed("X11 setup reported no default screen"))?;
        let visual = screen
            .allowed_depths
            .iter()
            .flat_map(|depth| &depth.visuals)
            .find(|visual| visual.visual_id == screen.root_visual)
            .ok_or_else(|| DesktopError::capture_failed("X11 setup does not describe the root visual"))?;
        if visual.class != VisualClass::TRUE_COLOR {
            return Err(DesktopError::capture_failed(format!(
                "unsupported X11 root visual class {:?}; TrueColor is required",
                visual.class
            )));
        }
        let screen = Screen {
            root: screen.root,
            width: u32::from(screen.width_in_pixels),
            height: u32::from(screen.height_in_pixels),
            masks: ColorMasks {
                red: visual.red_mask,
                green: visual.green_mask,
                blue: visual.blue_mask,
            },
        };
        Ok(Self { conn, screen })
    }

    fn property(
        &self,
        window: Window,
        property: Atom,
        kind: Atom,
    ) -> Option<x11rb::protocol::xproto::GetPropertyReply> {
        let reply = self
            .conn
            .get_property(false, window, property, kind, 0, PROPERTY_WORDS)
            .ok()?
            .reply()
            .ok()?;
        (reply.value_len > 0).then_some(reply)
    }

    fn atom_name(&self, atom: Atom) -> Option<String> {
        let reply = self.conn.get_atom_name(atom).ok()?.reply().ok()?;
        Some(String::from_utf8_lossy(&reply.name).into_owned())
    }
}

impl XServer for X11Connection {
    fn screen(&self) -> Screen {
        self.screen
    }

    fn monitors(&self) -> CoreResult<Vec<Monitor>> {
        let reply = self
            .conn
            .randr_get_monitors(self.screen.root, true)
            .map_err(request_failed)?
            .reply()
            .map_err(|error| {
                DesktopError::capture_failed(format!("RandR monitor enumeration failed: {error}"))
            })?;
        Ok(reply
            .monitors
            .into_iter()
            .map(|monitor| Monitor {
                atom: monitor.name,
                name: self
                    .atom_name(monitor.name)
                    .unwrap_or_else(|| format!("Monitor {}", monitor.name)),
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
                primary: monitor.primary,
            })
            .collect())
    }

    fn atom(&self, name: &str) -> CoreResult<Atom> {
        self.conn
            .intern_atom(false, name.as_bytes())
            .map_err(request_failed)?
            .reply()
            .map(|reply| reply.atom)
            .map_err(request_failed)
    }

    fn words(&self, window: Window, property: Atom, kind: Atom) -> Option<Vec<u32>> {
        let reply = self.property(window, property, kind)?;
        let words: Vec<u32> = reply.value32()?.collect();
        Some(words)
    }

    fn bytes(&self, window: Window, property: Atom, kind: Atom) -> Option<Vec<u8>> {
        self.property(window, property, kind).map(|reply| reply.value)
    }

    fn placement(&self, window: Window) -> Option<Placement> {
        let attributes = self.conn.get_window_attributes(window).ok()?.reply().ok()?;
        let geometry = self.conn.get_geometry(window).ok()?.reply().ok()?;
        let origin = self
            .conn
            .translate_coordinates(window, self.screen.root, 0, 0)
            .ok()?
            .reply()
            .ok()?;
        Some(Placement {
            viewable: attributes.map_state == MapState::VIEWABLE,
            x: i32::from(origin.dst_x),
            y: i32::from(origin.dst_y),
            width: u32::from(geometry.width),
            height: u32::from(geometry.height),
        })
    }

    fn root_image(&self, rect: RootRect) -> CoreResult<Pixmap> {
        let out_of_range =
            || DesktopError::capture_failed("capture rectangle exceeds the X11 coordinate space");
        let x = i16::try_from(rect.x).map_err(|_| out_of_range())?;
        let y = i16::try_from(rect.y).map_err(|_| out_of_range())?;
        let width = u16::try_from(rect.width).map_err(|_| out_of_range())?;
        let height = u16::try_from(rect.height).map_err(|_| out_of_range())?;
        let reply = self
            .conn
            .get_image(ImageFormat::Z_PIXMAP, self.screen.root, x, y, width, height, !0)
            .map_err(request_failed)?
            .reply()
            .map_err(root_capture_failed)?;
        let setup = self.conn.setup();
        let format = setup
            .pixmap_formats
            .iter()
            .find(|format| format.depth == reply.depth)
            .ok_or_else(|| {
                DesktopError::capture_failed(format!(
                    "X server advertises no pixmap format for depth {}",
                    reply.depth
                ))
            })?;
        Ok(Pixmap {
            width: rect.width,
            height: rect.height,
            depth: reply.depth,
            bits_per_pixel: format.bits_per_pixel,
            scanline_pad: format.scanline_pad,
            lsb_first: setup.image_byte_order == ImageOrder::LSB_FIRST,
            data: reply.data,
        })
    }
}

fn request_failed(error: impl std::fmt::Display) -> DesktopError {
    DesktopError::capture_failed(format!("X11 request failed: {error}"))
}

fn root_capture_failed(error: ReplyError) -> DesktopError {
    match &error {
        ReplyError::X11Error(x11) if matches!(x11.error_kind, ErrorKind::Match | ErrorKind::Drawable) => {
            DesktopError::capture_failed(
                "X11 root window is not a readable drawable; rootless XWayland capture requires the Wayland portal backend",
            )
        }
        ReplyError::X11Error(_) | ReplyError::ConnectionError(_) => {
            DesktopError::capture_failed(format!("X11 GetImage failed: {error}"))
        }
    }
}
