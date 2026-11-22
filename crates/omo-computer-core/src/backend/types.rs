//! The argument and return types of the backend traits. They are in-process types, never
//! on the wire.

use crate::listing::{ElementInfo, Rect, WindowInfo};
use crate::observation::ImageMime;
use crate::params::{Button, ObserveOptions, Point};
use crate::results::PermissionState;

/// Which windows `windows()` lists; an empty filter lists every window.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WindowFilter {
    pub app: Option<String>,
    pub title: Option<String>,
    pub pid: Option<u32>,
}

/// The `windows()` listing: every record with its identity, and whether the walk was cut.
#[derive(Debug, Clone, PartialEq)]
pub struct WindowList {
    pub windows: Vec<WindowInfo>,
    pub truncated: bool,
}

/// What a capture or an input targets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    Window(String),
    Display(String),
    Desktop,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CaptureOptions {
    /// `false` asks for a pointer-free frame.
    pub cursor: bool,
    /// Draws a crosshair at this point in the space `click` consumes.
    pub crosshair: Option<Point>,
    pub region: Option<Rect>,
}

/// The encoded pixels of one capture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameBytes {
    pub width: u32,
    pub height: u32,
    pub mime: ImageMime,
    pub bytes: Vec<u8>,
}

/// One OS-level input event.
#[derive(Debug, Clone, PartialEq)]
pub enum InputEvent {
    PointerMove(Point),
    Button { button: Button, down: bool },
    Key { key: String, down: bool },
    Scroll { dx: f64, dy: f64 },
    Text(String),
}

/// An input event carrying the engine's tag, so listeners can tell it from the user's.
#[derive(Debug, Clone, PartialEq)]
pub struct TaggedInput {
    pub event: InputEvent,
    pub tag: u64,
}

/// The delivery route of an input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Ax,
    BackgroundWindow,
    BackgroundPid,
    ForegroundHid,
}

/// How many units of an input went out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Delivered {
    pub count: u32,
    pub of: u32,
}

/// The tri-state permission read; probing never prompts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PermissionProbe {
    pub capture: PermissionState,
    pub input: PermissionState,
    pub accessibility: PermissionState,
}

/// What the display configuration changed (displays, scale, session, lock).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpochChange {
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SnapshotRequest {
    pub target: Target,
    pub options: ObserveOptions,
}

/// One accessibility snapshot of a target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AxSnapshot {
    pub tree: String,
    pub nodes_observed: u32,
    pub complete: bool,
    pub generation: u64,
}

/// A ref token `${snapshotId}:e${n}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ref(pub String);

/// A ref resolved to its live element.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
    pub element: ElementInfo,
}

/// A semantic action from the closed per-OS vocabulary (`press`, `focus`, ...).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Semantic(pub String);

/// One accessibility event from an observer registered on a window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AxEvent {
    pub kind: String,
    pub window: String,
}
