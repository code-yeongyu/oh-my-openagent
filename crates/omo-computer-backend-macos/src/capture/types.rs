//! The records capture reads through the OS seam, before any policy applies.

use omo_computer_core::listing::Rect;

/// One `CGWindowListCopyWindowInfo` record, in the list's front-to-back order.
#[derive(Debug, Clone, PartialEq)]
pub struct CgWindow {
    /// `kCGWindowNumber`.
    pub number: u32,
    /// `kCGWindowOwnerPID`.
    pub pid: u32,
    /// `kCGWindowOwnerName`.
    pub owner: String,
    /// `kCGWindowName`; empty when the OS withholds it.
    pub title: String,
    /// `kCGWindowBounds` in points, top-left origin of the main display.
    pub bounds: Rect,
    /// `kCGWindowLayer`; 0 is the normal application layer.
    pub layer: i32,
    /// `kCGWindowIsOnscreen`.
    pub on_screen: bool,
}

/// What the accessibility side knows of a window the list names.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AxWindowFacts {
    /// `kAXMinimizedAttribute`.
    pub minimized: bool,
    /// The window is its app's `kAXFocusedWindowAttribute`. Every running app has one, so this
    /// alone never makes a window focused: the listing also requires the app to be frontmost.
    pub focused_in_app: bool,
    /// `kAXTitleAttribute`, used when the list withholds the title.
    pub title: Option<String>,
}

/// One active display: `CGDisplayBounds` in points and its backing pixel size.
#[derive(Debug, Clone, PartialEq)]
pub struct DisplayRecord {
    /// `CGDirectDisplayID`.
    pub id: u32,
    pub bounds: Rect,
    /// `CGDisplayPixelsWide` of the current mode's backing store.
    pub pixel_width: u32,
    pub pixel_height: u32,
    /// `CGMainDisplayID`.
    pub main: bool,
}

/// The RGBA pixels of one capture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawFrame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Why an OS capture call produced no frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureFault {
    /// The call answered with no image.
    NullFrame,
    /// No frame arrived before the per-frame deadline.
    Timeout,
    /// The capture helper is not running and could not be started.
    HelperGone,
    /// The OS refused the capture (Screen Recording not granted).
    Denied,
    /// The helper answered something the protocol does not allow.
    Protocol,
}
