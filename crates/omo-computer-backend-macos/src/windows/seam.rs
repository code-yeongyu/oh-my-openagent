//! The macOS window calls the frame verbs and the window query make: `AXPosition`,
//! `AXSize`, `AXMinimized`, `AXFullScreen` and the app's AX windows. [`super::os::Os`] is the
//! macOS implementation; tests script a fake.

use omo_computer_core::listing::Rect;

/// One window the app's AX tree shows, including the ones the window list omits (sheets,
/// popovers, windows on another Space).
#[derive(Debug, Clone, PartialEq)]
pub struct FoundWindow {
    /// The window number when the private `_AXUIElementGetWindow` resolved it.
    pub number: Option<u32>,
    pub role: String,
    pub subrole: Option<String>,
    pub title: Option<String>,
    pub frame: Option<Rect>,
}

/// One element the window query walks: its facts and the id a children read takes.
#[derive(Debug, Clone, PartialEq)]
pub struct QueryNode {
    pub id: u64,
    pub found: FoundWindow,
}

/// The AX side of window placement.
pub trait WindowOs: Send {
    /// `AXPosition` + `AXSize` read back; `None` when the window has no AX element.
    fn frame(&mut self, window: u32) -> Option<Rect>;
    /// `AXUIElementIsAttributeSettable(AXPosition)`.
    fn position_settable(&mut self, window: u32) -> Option<bool>;
    /// `AXFullScreen`.
    fn full_screen(&mut self, window: u32) -> Option<bool>;
    fn set_position(&mut self, window: u32, x: f64, y: f64) -> bool;
    fn set_size(&mut self, window: u32, width: f64, height: f64) -> bool;
    fn minimized(&mut self, window: u32) -> Option<bool>;
    fn set_minimized(&mut self, window: u32, minimized: bool) -> bool;
    /// The app's `AXWindows` (AX lists only the windows on the current Space).
    fn app_windows(&mut self, pid: u32) -> Vec<QueryNode>;
    /// `AXChildren` of a node the query read.
    fn children(&mut self, node: u64) -> Vec<QueryNode>;
    /// The window list's application-layer windows of `pid`, on every Space.
    fn listed_windows(&mut self, pid: u32) -> Vec<FoundWindow>;
}
