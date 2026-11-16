//! The D-Bus / AT-SPI surface the backend reads and acts through, as one trait: `live` answers
//! over the accessibility bus (one connection per engine), `fake` from a scripted tree that
//! counts every call. Every decision above this seam runs without an accessibility bus.

use std::path::PathBuf;
use std::time::Duration;

/// The longest any one round trip may take, whatever the caller's deadline.
pub const CALL_BUDGET: Duration = Duration::from_secs(5);

/// A read's slice inside an observe: 250 ms, or less when the deadline is nearer.
pub const READ_SLICE_MS: u64 = 250;

/// The slice of one read, cut from what is left of the observe deadline.
#[must_use]
pub fn read_slice(remaining_ms: u64) -> Duration {
    Duration::from_millis(remaining_ms.min(READ_SLICE_MS)).min(CALL_BUDGET)
}

/// The slice of one mutation: the larger of 250 ms and half the remainder.
#[must_use]
pub fn mutation_slice(remaining_ms: u64) -> Duration {
    Duration::from_millis(READ_SLICE_MS.max(remaining_ms / 2)).min(CALL_BUDGET)
}

/// One accessible object as the bus addresses it: the owning connection and the object path.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeId {
    pub bus: String,
    pub path: String,
}

impl NodeId {
    #[must_use]
    pub fn new(bus: impl Into<String>, path: impl Into<String>) -> Self {
        Self {
            bus: bus.into(),
            path: path.into(),
        }
    }

    /// `atspi:<bus name>:<object path>`: the id a frame is listed under.
    #[must_use]
    pub fn object_id(&self) -> String {
        format!("atspi:{}:{}", self.bus, self.path)
    }

    /// The node an `atspi:` id names; `None` for any other id.
    #[must_use]
    pub fn parse(id: &str) -> Option<Self> {
        let rest = id.strip_prefix("atspi:")?;
        let (bus, path) = rest.split_once(":/")?;
        Some(Self::new(bus, format!("/{path}")))
    }
}

/// One registered application: its root, the pid owning its connection, its name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppRef {
    pub node: NodeId,
    pub pid: Option<u32>,
    pub name: String,
}

/// The states the backend decides on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct States {
    pub focused: bool,
    pub busy: bool,
    pub checked: bool,
    pub enabled: bool,
    pub active: bool,
    pub expanded: bool,
    pub selected: bool,
}

/// The interfaces an object implements, as far as the backend reads them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Interfaces {
    pub action: bool,
    pub text: bool,
    pub component: bool,
}

/// Component extents in global screen coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Extents {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// One read of one object.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct NodeFacts {
    /// The AT-SPI role name (`push button`, `password text`); empty when unreadable.
    pub role: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub accessible_id: Option<String>,
    pub states: States,
    pub interfaces: Interfaces,
    pub child_count: u32,
    pub extents: Option<Extents>,
}

/// One AT-SPI event: `object:state-changed:focused`, `window:activate`, ...
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BusEvent {
    pub kind: String,
    pub sender: NodeId,
    pub detail: i32,
}

/// The process owning a well-known name on the session bus.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerProcess {
    pub pid: u32,
    pub name: String,
}

/// A failed round trip.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BusError {
    /// No accessibility bus or no registry.
    Unreachable,
    /// No reply inside the slice: the object is `unknown`, never gone.
    Timeout,
    /// The object is gone, or the call failed.
    Failed(String),
}

pub type BusResult<T> = Result<T, BusError>;

/// Every round trip the backend makes; each one bounded by its slice and [`CALL_BUDGET`].
pub trait Bus: Send {
    /// The bus's clock in milliseconds.
    fn now_ms(&self) -> u64;
    /// The registry's children: one entry per registered application, with its pid.
    fn applications(&mut self, slice: Duration) -> BusResult<Vec<AppRef>>;
    fn children(&mut self, node: &NodeId, slice: Duration) -> BusResult<Vec<NodeId>>;
    fn read(&mut self, node: &NodeId, slice: Duration) -> BusResult<NodeFacts>;
    /// The Text interface's contents.
    fn text(&mut self, node: &NodeId, slice: Duration) -> BusResult<String>;
    fn parent(&mut self, node: &NodeId, slice: Duration) -> BusResult<Option<NodeId>>;
    fn action_count(&mut self, node: &NodeId, slice: Duration) -> BusResult<i32>;
    /// One action's name; names are read per index, never batched.
    fn action_name(&mut self, node: &NodeId, index: i32, slice: Duration) -> BusResult<String>;
    fn do_action(&mut self, node: &NodeId, index: i32, slice: Duration) -> BusResult<bool>;
    /// `org.a11y.Status.IsEnabled`.
    fn a11y_enabled(&mut self) -> BusResult<bool>;
    fn set_a11y_enabled(&mut self, enabled: bool) -> BusResult<()>;
    /// The object's attributes (`Accessible.GetAttributes`, or the `Document` interface's for
    /// a `document web` object): where the `URI` of a web document is read.
    fn attributes(&mut self, node: &NodeId, slice: Duration) -> BusResult<Vec<(String, String)>>;
    /// Registers the events the backend listens to (`RegisterEvent` plus the match rule).
    fn register_events(&mut self, kinds: &[&str]) -> BusResult<()>;
    /// The events the connection already received, in arrival order: no round trip.
    fn pending_events(&mut self) -> Vec<BusEvent>;
    /// The next event, waiting at most `timeout`; `None` when none came.
    fn wait_event(&mut self, timeout: Duration) -> BusResult<Option<BusEvent>>;
    /// The owner of `org.freedesktop.Notifications`.
    fn notification_owner(&mut self) -> BusResult<Option<OwnerProcess>>;
    /// The `.desktop` files of `XDG_DATA_HOME` and `XDG_DATA_DIRS`, with their contents.
    fn desktop_files(&mut self) -> Vec<(PathBuf, String)>;
}
