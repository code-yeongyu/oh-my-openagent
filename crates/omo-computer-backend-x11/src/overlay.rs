//! The X11 presence surface (design row L7): while a foreground lease lives, four thin
//! override-redirect border windows frame the screen. They take no input (an empty input
//! shape), and the capture never sees them: a Composite read is the target's own pixmap, and a
//! root crop unmaps them for the read and maps them back after.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use omo_computer_core::backend::{BackendResult, Presence, Refusal};
use omo_computer_core::error::EngineCode;

use crate::capture::server::PixelRect;

/// The border colour (0xRRGGBB); the overlay-colour oracle counts it.
pub const OVERLAY_RGB: u32 = 0x00FF_6A00;
/// The border's thickness in device pixels.
pub const BORDER_PX: u32 = 4;

/// The X requests the overlay makes, on a connection of its own.
pub trait OverlayServer: Send {
    /// The root size.
    fn screen(&self) -> (u32, u32);

    /// Creates an override-redirect window of `rgb` over `rect` with an empty input shape,
    /// unmapped.
    ///
    /// # Errors
    /// The request failed.
    fn create(&mut self, rect: PixelRect, rgb: u32) -> Result<u32, String>;

    /// # Errors
    /// The request failed.
    fn set_mapped(&mut self, windows: &[u32], mapped: bool) -> Result<(), String>;
}

/// The four edges of a `width` x `height` screen.
#[must_use]
pub fn borders(width: u32, height: u32) -> [PixelRect; 4] {
    let (w, h, b) = (width, height, BORDER_PX.min(width).min(height));
    let tall = i32::try_from(h.saturating_sub(b)).unwrap_or(0);
    let wide = i32::try_from(w.saturating_sub(b)).unwrap_or(0);
    [
        PixelRect {
            x: 0,
            y: 0,
            width: w,
            height: b,
        },
        PixelRect {
            x: 0,
            y: tall,
            width: w,
            height: b,
        },
        PixelRect {
            x: 0,
            y: 0,
            width: b,
            height: h,
        },
        PixelRect {
            x: wide,
            y: 0,
            width: b,
            height: h,
        },
    ]
}

struct State {
    server: Option<Box<dyn OverlayServer>>,
    windows: Vec<u32>,
    shown: bool,
}

/// The overlay shared by the backend (which hides it around a root read) and each presence
/// handle it hands out.
#[derive(Clone)]
pub struct Overlay(Arc<Mutex<State>>);

fn unavailable(_error: String) -> Refusal {
    Refusal::new(EngineCode::ControlRequired, "no_presence_surface")
}

impl Overlay {
    #[must_use]
    pub fn new(server: Option<Box<dyn OverlayServer>>) -> Self {
        Self(Arc::new(Mutex::new(State {
            server,
            windows: Vec::new(),
            shown: false,
        })))
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    #[must_use]
    pub fn available(&self) -> bool {
        self.lock().server.is_some()
    }

    #[must_use]
    pub fn is_shown(&self) -> bool {
        self.lock().shown
    }

    /// Runs `read` with the overlay unmapped when it is shown, mapping it back after.
    pub fn hidden_for<T>(&self, read: impl FnOnce() -> T) -> T {
        let mut state = self.lock();
        let shown = state.shown;
        let windows = state.windows.clone();
        if let (true, Some(server)) = (shown, state.server.as_mut()) {
            let _ = server.set_mapped(&windows, false);
        }
        let value = read();
        if let (true, Some(server)) = (shown, state.server.as_mut()) {
            let _ = server.set_mapped(&windows, true);
        }
        value
    }
}

impl Presence for Overlay {
    fn show(&mut self) -> BackendResult<()> {
        let mut state = self.lock();
        let state = &mut *state;
        let server = state
            .server
            .as_mut()
            .ok_or_else(|| unavailable(String::new()))?;
        if state.windows.is_empty() {
            let (width, height) = server.screen();
            for rect in borders(width, height) {
                state
                    .windows
                    .push(server.create(rect, OVERLAY_RGB).map_err(unavailable)?);
            }
        }
        server
            .set_mapped(&state.windows, true)
            .map_err(unavailable)?;
        state.shown = true;
        Ok(())
    }

    fn hide(&mut self) -> BackendResult<()> {
        let mut state = self.lock();
        let state = &mut *state;
        state.shown = false;
        match state.server.as_mut() {
            Some(server) => server
                .set_mapped(&state.windows, false)
                .map_err(unavailable),
            None => Ok(()),
        }
    }
}

/// The live overlay: windows on a connection of their own to the backend's display.
pub struct XOverlay {
    conn: x11rb::rust_connection::RustConnection,
    root: u32,
    size: (u32, u32),
}

impl XOverlay {
    /// # Errors
    /// The display cannot be reached.
    pub fn connect(display: &str) -> Result<Self, String> {
        let (conn, screen) = x11rb::connect(Some(display)).map_err(|e| e.to_string())?;
        let root = conn.setup().roots.get(screen).ok_or("no screen")?;
        let (root, size) = (
            root.root,
            (
                u32::from(root.width_in_pixels),
                u32::from(root.height_in_pixels),
            ),
        );
        Ok(Self { conn, root, size })
    }
}

use x11rb::connection::Connection as _;
use x11rb::protocol::xfixes::ConnectionExt as _;
use x11rb::protocol::xproto::ConnectionExt as _;

impl OverlayServer for XOverlay {
    fn screen(&self) -> (u32, u32) {
        self.size
    }

    fn create(&mut self, rect: PixelRect, rgb: u32) -> Result<u32, String> {
        use x11rb::protocol::xproto::{CreateWindowAux, WindowClass};
        let text = |e: &dyn std::fmt::Display| e.to_string();
        let id = self.conn.generate_id().map_err(|e| text(&e))?;
        let aux = CreateWindowAux::new()
            .override_redirect(1)
            .background_pixel(rgb);
        let (x, y) = (
            i16::try_from(rect.x).unwrap_or(0),
            i16::try_from(rect.y).unwrap_or(0),
        );
        let (w, h) = (
            u16::try_from(rect.width).unwrap_or(1),
            u16::try_from(rect.height).unwrap_or(1),
        );
        self.conn
            .create_window(
                0,
                id,
                self.root,
                x,
                y,
                w,
                h,
                0,
                WindowClass::INPUT_OUTPUT,
                0,
                &aux,
            )
            .map_err(|e| text(&e))?;
        let region = self.conn.generate_id().map_err(|e| text(&e))?;
        self.conn
            .xfixes_create_region(region, &[])
            .map_err(|e| text(&e))?;
        self.conn
            .xfixes_set_window_shape_region(id, x11rb::protocol::shape::SK::INPUT, 0, 0, region)
            .map_err(|e| text(&e))?;
        self.conn
            .xfixes_destroy_region(region)
            .map_err(|e| text(&e))?;
        self.conn.flush().map_err(|e| text(&e))?;
        Ok(id)
    }

    fn set_mapped(&mut self, windows: &[u32], mapped: bool) -> Result<(), String> {
        for &window in windows {
            let sent = if mapped {
                self.conn.map_window(window)
            } else {
                self.conn.unmap_window(window)
            };
            sent.map_err(|e| e.to_string())?;
        }
        self.conn.flush().map_err(|e| e.to_string())?;
        self.conn
            .get_input_focus()
            .map_err(|e| e.to_string())?
            .reply()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}
