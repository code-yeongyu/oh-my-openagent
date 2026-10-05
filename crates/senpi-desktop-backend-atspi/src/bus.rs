//! The proxy shim: every AT-SPI round trip the backend makes, as one trait.
//! `LiveBus` answers over D-Bus; the unit tests answer from an in-memory tree,
//! so every decision above this seam runs without an accessibility bus.

use atspi::{InterfaceSet, Role, StateSet};

/// A failed round trip, already worded for an `AxFailed` message.
pub type BusResult<T> = Result<T, String>;

/// Component extents in global screen coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Extents {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// A point in global screen coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenPoint {
    pub x: i32,
    pub y: i32,
}

pub trait AtSpiBus {
    /// One accessible object as the bus addresses it.
    type Node: Clone + 'static;

    /// The registry root's children: one node per registered application.
    fn applications(&mut self) -> BusResult<Vec<Self::Node>>;
    /// The pid owning `app`'s bus connection, when the bus reports it.
    fn process_id(&mut self, app: &Self::Node) -> Option<u32>;
    fn is_null(&self, node: &Self::Node) -> bool;
    /// Stable `atspi:<bus name>:<object path>` id for a top-level window.
    fn object_id(&self, node: &Self::Node) -> String;

    fn name(&mut self, node: &Self::Node) -> BusResult<String>;
    fn description(&mut self, node: &Self::Node) -> BusResult<String>;
    fn role(&mut self, node: &Self::Node) -> BusResult<Role>;
    fn role_name(&mut self, node: &Self::Node) -> BusResult<String>;
    fn localized_role_name(&mut self, node: &Self::Node) -> BusResult<String>;
    fn state(&mut self, node: &Self::Node) -> BusResult<StateSet>;
    fn interfaces(&mut self, node: &Self::Node) -> BusResult<InterfaceSet>;
    fn attributes(&mut self, node: &Self::Node) -> BusResult<Vec<(String, String)>>;
    fn children(&mut self, node: &Self::Node) -> BusResult<Vec<Self::Node>>;
    fn child_count(&mut self, node: &Self::Node) -> BusResult<i32>;
    fn parent(&mut self, node: &Self::Node) -> BusResult<Self::Node>;

    fn extents(&mut self, node: &Self::Node) -> BusResult<Extents>;
    fn contains(&mut self, node: &Self::Node, point: ScreenPoint) -> BusResult<bool>;
    fn accessible_at_point(&mut self, node: &Self::Node, point: ScreenPoint) -> BusResult<Self::Node>;
    fn grab_focus(&mut self, node: &Self::Node) -> BusResult<bool>;

    fn actions(&mut self, node: &Self::Node) -> BusResult<Vec<String>>;
    fn do_action(&mut self, node: &Self::Node, index: i32) -> BusResult<bool>;

    /// The first `max_chars` characters of the Text interface.
    fn text(&mut self, node: &Self::Node, max_chars: i32) -> BusResult<String>;
    fn set_text_contents(&mut self, node: &Self::Node, text: &str) -> BusResult<bool>;
    fn set_current_value(&mut self, node: &Self::Node, value: f64) -> BusResult<()>;
}
