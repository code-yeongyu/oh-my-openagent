//! The macOS accessibility calls the AX backend makes. [`super::os::Server`] implements them
//! on macOS over `AXUIElement`; tests script a fake AX server, so every rule above the seam
//! (one IPC per node, the deadline, the observer feed, the busy predicate) runs on every OS.

use omo_computer_core::ax::Slice;
use omo_computer_core::listing::Rect;

/// The server's id of one retained `AXUIElement`.
pub type Element = u64;

/// The eleven notifications one `AXObserver` per target app registers (design: settle).
pub const NOTIFICATIONS: [&str; 11] = [
    "AXUIElementDestroyed",
    "AXValueChanged",
    "AXTitleChanged",
    "AXMoved",
    "AXResized",
    "AXSelectedChildrenChanged",
    "AXSelectedTextChanged",
    "AXFocusedUIElementChanged",
    "AXFocusedWindowChanged",
    "AXWindowCreated",
    "AXLayoutChanged",
];

/// The attribute set one node read returns, in ONE `AXUIElementCopyMultipleAttributeValues`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Attributes {
    pub role: String,
    pub subrole: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub value: Option<String>,
    pub identifier: Option<String>,
    pub enabled: Option<bool>,
    pub focused: Option<bool>,
    pub selected: Option<bool>,
    pub expanded: Option<bool>,
    pub actions: Vec<String>,
    pub frame: Option<Rect>,
    pub child_count: u32,
    /// `AXElementBusy`.
    pub busy: Option<bool>,
    /// `AXLoaded` (web areas).
    pub loaded: Option<bool>,
    /// An `AXProgressIndicator` without a known value.
    pub indeterminate: Option<bool>,
}

/// Who owns a window: its pid, the process start and the app's name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowOwner {
    pub pid: u32,
    pub process_start: u64,
    pub app: String,
    pub bundle: Option<String>,
}

/// One observer callback, attributed to its window through an `AXParent` walk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notified {
    pub notification: String,
    pub pid: u32,
    pub element: Element,
    /// The window number the element belongs to; `None` when the walk could not attribute it.
    pub window: Option<u32>,
}

/// A value an attribute is set to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AxValue {
    Text(String),
    Bool(bool),
    Range { location: u32, length: u32 },
}

/// What an action or a write answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AxStatus {
    Done,
    /// `kAXErrorActionUnsupported` / `kAXErrorAttributeUnsupported`.
    Unsupported,
    /// `kAXErrorInvalidUIElement`: the element is gone.
    Gone,
    Failed,
}

/// The accessibility server of the desktop.
pub trait AxServer: Send {
    /// Monotonic milliseconds.
    fn now_ms(&self) -> u64;
    fn window_owner(&mut self, number: u32) -> Option<WindowOwner>;
    /// The `AXWindow` element of `number` in `pid`'s tree.
    fn window(&mut self, pid: u32, number: u32) -> Option<Element>;
    /// The application element of `pid`.
    fn app(&mut self, pid: u32) -> Option<Element>;
    /// `kAXMenuBarAttribute` of the application.
    fn menu_bar(&mut self, pid: u32) -> Option<Element>;
    /// ONE IPC: the node's attribute set; `Read(None)` when the element is gone.
    fn read(&mut self, element: Element, slice_ms: u64) -> Slice<Option<Attributes>>;
    /// `AXUIElementCopyActionNames`: a second IPC, made only for an unlabelled container
    /// whose actions decide whether the walk may treat it as a wrapper.
    fn actions(&mut self, element: Element, slice_ms: u64) -> Slice<Vec<String>>;
    /// `kAXChildrenAttribute` values `[from, from + count)`.
    fn children(
        &mut self,
        element: Element,
        from: u32,
        count: u32,
        slice_ms: u64,
    ) -> Slice<Vec<Element>>;
    /// Reads the app's `AXRole`: Chromium starts building its web tree on it.
    fn poke_role(&mut self, app: Element);
    /// Registers the eleven notifications on `pid`; `false` when the observer could not be
    /// created or took none of them (the caller retries on its next read).
    fn observe(&mut self, pid: u32) -> bool;
    /// The next observer callback, waited for on the observer feed until `until_ms` and never
    /// past it (no polling, no sleep); `None` at the deadline.
    fn wait_notification(&mut self, until_ms: u64) -> Option<Notified>;
    fn perform(&mut self, element: Element, action: &str) -> AxStatus;
    fn set(&mut self, element: Element, attribute: &str, value: AxValue) -> AxStatus;
    /// The process of a running app by bundle id.
    fn process_of_bundle(&mut self, bundle: &str) -> Option<u32>;
    /// `Contents/Frameworks/Electron Framework.framework` beside `pid`'s executable.
    fn is_electron(&mut self, pid: u32) -> bool;
    /// The private remote-token pair when it resolved for this macOS major; `None` otherwise.
    fn remote_token(&mut self) -> Option<&mut dyn RemoteToken>;
}

/// `_AXUIElementRemoteTokenCreate` / `_AXUIElementCreateWithRemoteToken`.
pub trait RemoteToken: Send {
    fn token(&mut self, element: Element) -> Option<Vec<u8>>;
    fn resolve(&mut self, token: &[u8]) -> Option<Element>;
}
