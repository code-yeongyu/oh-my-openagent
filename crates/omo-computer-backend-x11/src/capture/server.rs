//! The seam between the capture logic and the X server: everything the capture reads goes
//! through [`XServer`], so the tests drive it with an in-memory server and the engine with
//! the x11rb connection.

use std::fmt;

/// A rectangle in root-window device pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl PixelRect {
    #[must_use]
    pub fn contains(&self, x: i32, y: i32) -> bool {
        let (left, top) = (i64::from(self.x), i64::from(self.y));
        let (x, y) = (i64::from(x), i64::from(y));
        x >= left
            && y >= top
            && x < left + i64::from(self.width)
            && y < top + i64::from(self.height)
    }
}

/// The colour masks of a TrueColor visual.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChannelMasks {
    pub red: u32,
    pub green: u32,
    pub blue: u32,
}

/// The root screen of the connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Screen {
    pub root: u32,
    pub width: u32,
    pub height: u32,
    pub width_mm: u32,
    pub height_mm: u32,
}

/// One RandR monitor (`GetMonitors`), in device pixels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Monitor {
    /// The monitor's name atom.
    pub atom: u32,
    pub name: String,
    pub primary: bool,
    pub rect: PixelRect,
    pub width_mm: u32,
    pub height_mm: u32,
}

/// The bytes of one `GetImage(ZPixmap)` reply with what decoding them needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZImage {
    pub width: u32,
    pub height: u32,
    pub bits_per_pixel: u8,
    /// Scanline padding in bits.
    pub scanline_pad: u8,
    pub msb_first: bool,
    pub masks: ChannelMasks,
    pub data: Vec<u8>,
}

/// The XFixes cursor image: position and hotspot in root device pixels, premultiplied ARGB.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CursorImage {
    pub x: i32,
    pub y: i32,
    pub xhot: u32,
    pub yhot: u32,
    pub width: u32,
    pub height: u32,
    pub argb: Vec<u32>,
}

/// Where a window is and whether it can be captured.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowPlacement {
    /// The client area in root device pixels (the border excluded).
    pub rect: PixelRect,
    pub border: u32,
    pub viewable: bool,
    /// Iconic `WM_STATE` or `_NET_WM_STATE_HIDDEN`.
    pub minimized: bool,
    pub visual: u32,
}

/// One EWMH client as the window manager lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientWindow {
    pub xid: u32,
    pub title: String,
    /// The `WM_CLASS` class (the instance when the class is absent).
    pub class: String,
    pub pid: Option<u32>,
    pub focused: bool,
    pub desktop: Option<u32>,
    pub placement: WindowPlacement,
}

/// What reading a window's own pixmap gave.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PixmapRead {
    /// The window's own pixels, occluders excluded.
    Image(ZImage),
    /// Composite is absent or the redirect was refused: only a root crop is possible.
    RedirectRefused,
    /// The window has no pixmap (unmapped between the placement read and the capture).
    Unmapped,
    /// The window was redirected for the read but did not repaint before the Damage deadline
    /// (or Damage is absent), so its fresh pixmap may still hold the parent's pixels.
    NotRepainted,
}

/// A failed X request, as text for the engine log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct XError(pub String);

impl fmt::Display for XError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for XError {}

/// The X server reads the capture needs.
pub trait XServer: Send {
    fn screen(&self) -> Screen;

    /// Whether the Composite extension answered its version query.
    fn composite_available(&self) -> bool;

    /// RandR active monitors; empty when RandR is absent.
    ///
    /// # Errors
    /// The request failed.
    fn monitors(&self) -> Result<Vec<Monitor>, XError>;

    /// The root `RESOURCE_MANAGER` property, `None` when unset.
    ///
    /// # Errors
    /// The request failed.
    fn resource_manager(&self) -> Result<Option<String>, XError>;

    /// `GetImage(ZPixmap)` of the root over `rect`.
    ///
    /// # Errors
    /// The request failed.
    fn root_image(&self, rect: PixelRect) -> Result<ZImage, XError>;

    /// `None` when the window does not exist.
    ///
    /// # Errors
    /// The request failed.
    fn window_placement(&self, window: u32) -> Result<Option<WindowPlacement>, XError>;

    /// Whether a compositing manager owns `_NET_WM_CM_S<screen>`.
    ///
    /// # Errors
    /// The request failed.
    fn compositor_present(&self) -> Result<bool, XError>;

    /// The window's own pixmap after one Damage round trip; the window is redirected
    /// `CompositeRedirectAutomatic` for the read and unredirected after.
    ///
    /// # Errors
    /// The request failed.
    fn window_pixmap(
        &self,
        window: u32,
        placement: &WindowPlacement,
    ) -> Result<PixmapRead, XError>;

    /// `_NET_CLIENT_LIST_STACKING` (else `_NET_CLIENT_LIST`), topmost first; a client that
    /// vanished during the walk is left out.
    ///
    /// # Errors
    /// The request failed.
    fn client_windows(&self) -> Result<Vec<ClientWindow>, XError>;

    /// The XFixes cursor image; `None` when XFixes is absent.
    ///
    /// # Errors
    /// The request failed.
    fn cursor(&self) -> Result<Option<CursorImage>, XError>;
}
