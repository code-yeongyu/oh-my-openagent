//! The live [`XServer`] over a pure-Rust x11rb connection. The connection is the capture's
//! own: events polled during the Damage wait belong to it alone.

use std::time::{Duration, Instant};

use x11rb::connection::{Connection, RequestConnection};
use x11rb::errors::{ConnectError, ConnectionError, ReplyError, ReplyOrIdError};
use x11rb::protocol::composite::{self, ConnectionExt as _};
use x11rb::protocol::damage::{self, ConnectionExt as _};

use super::damage_wait::{after_notify, DamageWait};
use x11rb::protocol::randr::{self, ConnectionExt as _};
use x11rb::protocol::xfixes::{self, ConnectionExt as _};
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, ImageFormat, ImageOrder, MapState};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;

use super::server::{
    ChannelMasks, ClientWindow, CursorImage, Monitor, PixelRect, PixmapRead, Screen, WindowPlacement, XError,
    XServer, ZImage,
};

const DAMAGE_WAIT: Duration = Duration::from_millis(100);
const DAMAGE_POLL: Duration = Duration::from_millis(2);
const ICONIC_STATE: u32 = 3;

macro_rules! from_error {
    ($($kind:ty),*) => {$(
        impl From<$kind> for XError {
            fn from(error: $kind) -> Self {
                Self(error.to_string())
            }
        }
    )*};
}
from_error!(ConnectError, ConnectionError, ReplyError, ReplyOrIdError);

fn is_x11_error(error: &ReplyError) -> bool {
    matches!(error, ReplyError::X11Error(_))
}

fn coordinate(value: i32) -> Result<i16, XError> {
    i16::try_from(value).map_err(|_| XError(format!("coordinate {value} is outside the X range")))
}

fn extent(value: u32) -> Result<u16, XError> {
    u16::try_from(value).map_err(|_| XError(format!("extent {value} is outside the X range")))
}

/// A connection to one X display with the extensions the capture uses.
pub struct X11Connection {
    pub(super) conn: RustConnection,
    screen_index: usize,
    composite: bool,
    damage: bool,
    xfixes: bool,
    randr: bool,
}

impl X11Connection {
    /// Connects to `display` (the `DISPLAY` value) and negotiates the extensions.
    ///
    /// # Errors
    /// The display cannot be reached.
    pub fn connect(display: &str) -> Result<Self, XError> {
        let (conn, screen_index) = x11rb::connect(Some(display))?;
        let present = |name: &'static str| conn.extension_information(name).ok().flatten().is_some();
        let composite = present(composite::X11_EXTENSION_NAME)
            && conn.composite_query_version(0, 4).map(|c| c.reply().is_ok()).unwrap_or(false);
        let xfixes = present(xfixes::X11_EXTENSION_NAME)
            && conn.xfixes_query_version(4, 0).map(|c| c.reply().is_ok()).unwrap_or(false);
        let damage = present(damage::X11_EXTENSION_NAME)
            && conn.damage_query_version(1, 1).map(|c| c.reply().is_ok()).unwrap_or(false);
        let randr = present(randr::X11_EXTENSION_NAME)
            && conn.randr_query_version(1, 5).map(|c| c.reply().is_ok()).unwrap_or(false);
        Ok(Self {
            conn,
            screen_index,
            composite,
            damage,
            xfixes,
            randr,
        })
    }

    fn root(&self) -> u32 {
        self.conn.setup().roots[self.screen_index].root
    }

    fn masks_of(&self, visual: u32) -> ChannelMasks {
        self.conn
            .setup()
            .roots
            .iter()
            .flat_map(|screen| &screen.allowed_depths)
            .flat_map(|depth| &depth.visuals)
            .find(|candidate| candidate.visual_id == visual)
            .map_or(
                ChannelMasks {
                    red: 0x00FF_0000,
                    green: 0x0000_FF00,
                    blue: 0x0000_00FF,
                },
                |found| ChannelMasks {
                    red: found.red_mask,
                    green: found.green_mask,
                    blue: found.blue_mask,
                },
            )
    }

    fn zimage(&self, depth: u8, visual: u32, width: u32, height: u32, data: Vec<u8>) -> Result<ZImage, XError> {
        let setup = self.conn.setup();
        let format = setup
            .pixmap_formats
            .iter()
            .find(|format| format.depth == depth)
            .ok_or_else(|| XError(format!("no pixmap format for depth {depth}")))?;
        Ok(ZImage {
            width,
            height,
            bits_per_pixel: format.bits_per_pixel,
            scanline_pad: format.scanline_pad,
            msb_first: setup.image_byte_order == ImageOrder::MSB_FIRST,
            masks: self.masks_of(visual),
            data,
        })
    }

    pub(super) fn atom(&self, name: &str) -> Result<u32, XError> {
        Ok(self.conn.intern_atom(false, name.as_bytes())?.reply()?.atom)
    }

    fn iconic(&self, window: u32) -> Result<bool, XError> {
        let wm_state = self.atom("WM_STATE")?;
        let state = self.conn.get_property(false, window, wm_state, wm_state, 0, 2)?.reply()?;
        if state.value32().and_then(|mut values| values.next()) == Some(ICONIC_STATE) {
            return Ok(true);
        }
        let net_state = self.atom("_NET_WM_STATE")?;
        let hidden = self.atom("_NET_WM_STATE_HIDDEN")?;
        let states = self.conn.get_property(false, window, net_state, AtomEnum::ATOM, 0, 64)?.reply()?;
        Ok(states.value32().is_some_and(|mut values| values.any(|atom| atom == hidden)))
    }

    /// Whether the client repainted before the deadline: the first `DamageNotify` is the server's
    /// own background paint from `ClearArea`, so it is subtracted and a second one is awaited.
    fn wait_damage(&self, damage_id: u32) -> Result<bool, XError> {
        let deadline = Instant::now() + DAMAGE_WAIT;
        let mut seen = 0;
        while Instant::now() < deadline {
            while let Some(event) = self.conn.poll_for_event()? {
                if matches!(event, Event::DamageNotify(notify) if notify.damage == damage_id) {
                    seen += 1;
                    match after_notify(seen) {
                        DamageWait::Repainted => return Ok(true),
                        DamageWait::SubtractAndWait => {
                            self.conn.damage_subtract(damage_id, x11rb::NONE, x11rb::NONE)?;
                            self.conn.flush()?;
                        }
                    }
                }
            }
            std::thread::sleep(DAMAGE_POLL);
        }
        Ok(false)
    }

    fn read_pixmap(&self, window: u32, placement: &WindowPlacement, redirected: bool) -> Result<PixmapRead, XError> {
        let damage_id = if self.damage {
            let id = self.conn.generate_id()?;
            self.conn.damage_create(id, window, damage::ReportLevel::NON_EMPTY)?.check()?;
            Some(id)
        } else {
            None
        };
        let mut repainted = true;
        if redirected {
            self.conn.clear_area(true, window, 0, 0, 0, 0)?;
            self.conn.flush()?;
            repainted = match damage_id {
                Some(id) => self.wait_damage(id)?,
                None => false,
            };
        }
        if !repainted {
            if let Some(id) = damage_id {
                self.conn.damage_destroy(id)?;
            }
            return Ok(PixmapRead::NotRepainted);
        }
        let pixmap = self.conn.generate_id()?;
        let named = self.conn.composite_name_window_pixmap(window, pixmap)?.check();
        let pixmap_named = named.is_ok();
        let read = match named {
            Err(error) if is_x11_error(&error) => Ok(PixmapRead::Unmapped),
            Err(error) => Err(error.into()),
            Ok(()) => self.pixmap_image(pixmap, placement),
        };
        if pixmap_named {
            self.conn.free_pixmap(pixmap)?;
        }
        if let Some(id) = damage_id {
            self.conn.damage_destroy(id)?;
        }
        read
    }

    fn pixmap_image(&self, pixmap: u32, placement: &WindowPlacement) -> Result<PixmapRead, XError> {
        let border = coordinate(i32::try_from(placement.border).unwrap_or(i32::MAX))?;
        let (width, height) = (extent(placement.rect.width)?, extent(placement.rect.height)?);
        let reply = self
            .conn
            .get_image(ImageFormat::Z_PIXMAP, pixmap, border, border, width, height, u32::MAX)?
            .reply();
        match reply {
            Ok(image) => Ok(PixmapRead::Image(self.zimage(
                image.depth,
                placement.visual,
                placement.rect.width,
                placement.rect.height,
                image.data,
            )?)),
            Err(error) if is_x11_error(&error) => Ok(PixmapRead::Unmapped),
            Err(error) => Err(error.into()),
        }
    }
}

impl XServer for X11Connection {
    fn screen(&self) -> Screen {
        let screen = &self.conn.setup().roots[self.screen_index];
        Screen {
            root: screen.root,
            width: u32::from(screen.width_in_pixels),
            height: u32::from(screen.height_in_pixels),
            width_mm: u32::from(screen.width_in_millimeters),
            height_mm: u32::from(screen.height_in_millimeters),
        }
    }

    fn composite_available(&self) -> bool {
        self.composite
    }

    fn monitors(&self) -> Result<Vec<Monitor>, XError> {
        if !self.randr {
            return Ok(Vec::new());
        }
        let reply = self.conn.randr_get_monitors(self.root(), true)?.reply()?;
        reply
            .monitors
            .into_iter()
            .map(|monitor| {
                let name = self.conn.get_atom_name(monitor.name)?.reply()?.name;
                Ok(Monitor {
                    atom: monitor.name,
                    name: String::from_utf8_lossy(&name).into_owned(),
                    primary: monitor.primary,
                    rect: PixelRect {
                        x: i32::from(monitor.x),
                        y: i32::from(monitor.y),
                        width: u32::from(monitor.width),
                        height: u32::from(monitor.height),
                    },
                    width_mm: monitor.width_in_millimeters,
                    height_mm: monitor.height_in_millimeters,
                })
            })
            .collect()
    }

    fn resource_manager(&self) -> Result<Option<String>, XError> {
        let reply = self
            .conn
            .get_property(false, self.root(), AtomEnum::RESOURCE_MANAGER, AtomEnum::STRING, 0, 1 << 20)?
            .reply()?;
        Ok((!reply.value.is_empty()).then(|| String::from_utf8_lossy(&reply.value).into_owned()))
    }

    fn root_image(&self, rect: PixelRect) -> Result<ZImage, XError> {
        let (x, y) = (coordinate(rect.x)?, coordinate(rect.y)?);
        let (width, height) = (extent(rect.width)?, extent(rect.height)?);
        let reply = self
            .conn
            .get_image(ImageFormat::Z_PIXMAP, self.root(), x, y, width, height, u32::MAX)?
            .reply()?;
        let visual = self.conn.setup().roots[self.screen_index].root_visual;
        self.zimage(reply.depth, visual, rect.width, rect.height, reply.data)
    }

    fn window_placement(&self, window: u32) -> Result<Option<WindowPlacement>, XError> {
        let attributes = match self.conn.get_window_attributes(window)?.reply() {
            Ok(attributes) => attributes,
            Err(error) if is_x11_error(&error) => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let geometry = self.conn.get_geometry(window)?.reply()?;
        let origin = self.conn.translate_coordinates(window, self.root(), 0, 0)?.reply()?;
        Ok(Some(WindowPlacement {
            rect: PixelRect {
                x: i32::from(origin.dst_x),
                y: i32::from(origin.dst_y),
                width: u32::from(geometry.width),
                height: u32::from(geometry.height),
            },
            border: u32::from(geometry.border_width),
            viewable: attributes.map_state == MapState::VIEWABLE,
            minimized: self.iconic(window)?,
            visual: attributes.visual,
        }))
    }

    fn compositor_present(&self) -> Result<bool, XError> {
        let selection = self.atom(&format!("_NET_WM_CM_S{}", self.screen_index))?;
        Ok(self.conn.get_selection_owner(selection)?.reply()?.owner != x11rb::NONE)
    }

    fn window_pixmap(&self, window: u32, placement: &WindowPlacement, redirect: bool) -> Result<PixmapRead, XError> {
        if !self.composite {
            return Ok(PixmapRead::RedirectRefused);
        }
        if redirect {
            match self.conn.composite_redirect_window(window, composite::Redirect::AUTOMATIC)?.check() {
                Ok(()) => {}
                Err(error) if is_x11_error(&error) => return Ok(PixmapRead::RedirectRefused),
                Err(error) => return Err(error.into()),
            }
        }
        let read = self.read_pixmap(window, placement, redirect);
        if redirect {
            self.conn.composite_unredirect_window(window, composite::Redirect::AUTOMATIC)?.check()?;
        }
        read
    }

    fn client_windows(&self) -> Result<Vec<ClientWindow>, XError> {
        self.read_clients()
    }

    fn cursor(&self) -> Result<Option<CursorImage>, XError> {
        if !self.xfixes {
            return Ok(None);
        }
        let reply = self.conn.xfixes_get_cursor_image()?.reply()?;
        Ok(Some(CursorImage {
            x: i32::from(reply.x),
            y: i32::from(reply.y),
            xhot: u32::from(reply.xhot),
            yhot: u32::from(reply.yhot),
            width: u32::from(reply.width),
            height: u32::from(reply.height),
            argb: reply.cursor_image,
        }))
    }
}
