//! The observer-event kinds the settle and `waitFor` read: macOS AX notifications, AT-SPI
//! events, UIA events, and the fake's snake_case names. An AT-SPI kind also matches with a
//! `:detail` suffix.

use omo_computer_core::params::{EventKind, WindowState};

const NAVIGATION: &[&str] = &[
    "AXWindowCreated",
    "AXMainWindowChanged",
    "AXFocusedWindowChanged",
    "AXApplicationActivated",
    "AXLoadComplete",
    "window:create",
    "window:activate",
    "document:load-complete",
    "document:reload",
    "WindowOpened",
    "window_opened",
    "navigation",
];
const OPENED: &[&str] = &[
    "AXWindowCreated",
    "window:create",
    "WindowOpened",
    "window_opened",
];
const CLOSED: &[&str] = &[
    "AXUIElementDestroyed",
    "window:destroy",
    "WindowClosed",
    "window_closed",
];
const FOCUSED_WINDOW: &[&str] = &[
    "AXFocusedWindowChanged",
    "AXMainWindowChanged",
    "window:activate",
    "window_focused",
];
const FOCUS: &[&str] = &[
    "AXFocusedUIElementChanged",
    "AXFocusedWindowChanged",
    "object:state-changed:focused",
    "FocusChanged",
    "focus",
];
const STRUCTURE: &[&str] = &[
    "AXCreated",
    "AXLayoutChanged",
    "AXRowCountChanged",
    "object:children-changed",
    "StructureChanged",
    "structure",
];
const PROPERTY: &[&str] = &[
    "AXValueChanged",
    "AXTitleChanged",
    "AXSelectedTextChanged",
    "object:property-change",
    "object:text-changed",
    "object:state-changed",
    "PropertyChanged",
    "property",
];

fn listed(list: &[&str], kind: &str) -> bool {
    list.iter().any(|name| {
        kind == *name
            || kind
                .strip_prefix(name)
                .is_some_and(|rest| rest.starts_with(':'))
    })
}

/// A navigation: the post-send settle switches to the navigation regime.
#[must_use]
pub fn is_navigation(kind: &str) -> bool {
    listed(NAVIGATION, kind)
}

/// The window change an event reports, for `waitFor({window})`.
#[must_use]
pub fn window_state(kind: &str) -> Option<WindowState> {
    if listed(OPENED, kind) {
        Some(WindowState::Appeared)
    } else if listed(CLOSED, kind) {
        Some(WindowState::Gone)
    } else if listed(FOCUSED_WINDOW, kind) {
        Some(WindowState::Focused)
    } else {
        None
    }
}

/// The event class of `waitFor({event})` an event belongs to.
#[must_use]
pub fn event_kind(kind: &str) -> Option<EventKind> {
    if listed(OPENED, kind) {
        Some(EventKind::WindowOpened)
    } else if listed(CLOSED, kind) {
        Some(EventKind::WindowClosed)
    } else if listed(FOCUS, kind) {
        Some(EventKind::Focus)
    } else if listed(STRUCTURE, kind) {
        Some(EventKind::Structure)
    } else if listed(PROPERTY, kind) {
        Some(EventKind::Property)
    } else {
        None
    }
}
