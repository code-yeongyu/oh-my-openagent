//! The JSON scenario format a fake backend serves.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::{DesktopCapabilities, DesktopDisplay, DesktopPoint, DesktopWindow};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::method::{AxWrite, FakeMethod};
pub use crate::scenario_nodes::{FakeAxNode, FakeBounds, FakeMenuNode};

const DEFAULT_CAPTURE_COLOR: [u8; 4] = [32, 96, 160, 255];

/// A parsed scenario. Loaded from JSON, whose top-level keys are snake_case
/// while embedded core types (`displays`, `windows`, `capabilities`) keep their
/// camelCase wire form. `capabilities` in JSON is a partial overlay on
/// [`fake_capabilities`]; `displayCount` defaults to the number of displays.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(try_from = "RawScenario")]
pub struct FakeScenario {
    pub displays: Vec<DesktopDisplay>,
    pub windows: Vec<DesktopWindow>,
    pub capabilities: DesktopCapabilities,
    /// Accessibility tree root per window id.
    pub ax: BTreeMap<String, FakeAxNode>,
    /// Menu-bar children per window id; absent means the backend has no menus.
    pub menus: BTreeMap<String, Vec<FakeMenuNode>>,
    /// Reports every AX element's owner as unknown, like a backend that
    /// cannot map an element to its native window.
    pub ax_owner_unknown: bool,
    /// Global cursor position; `None` models a backend without cursor access.
    pub cursor: Option<DesktopPoint>,
    /// RGBA fill of every captured image.
    pub capture_color: [u8; 4],
    pub delay_ms: DelayMs,
    pub resize_window: Option<ResizeWindow>,
    /// Failures queued at load time, as if `fail_next` had been called.
    pub fail_next: Vec<ScriptedFailure>,
    /// User presses that land right before the fake's next press of a method.
    pub user_presses: Vec<crate::user_input_impl::ScriptedUserPress>,
    /// Whether the backend exposes a user-input feed (false: a backend with no
    /// watch, as win32, x11 and wayland, or macOS while the watch is off).
    pub user_input_feed: bool,
    /// AX writes left unanswered at load time, in order, as if
    /// `Faults::cannot_complete_next` had been called.
    pub ax_cannot_complete: Vec<AxWrite>,
    /// Marks every capture's frame geometry `legacyCapture` (B9 fallback
    /// shape), so the wire carries the flag.
    pub legacy_capture: bool,
    /// Processes (by pid) whose windows show a remote screen, and how the
    /// client forwards input (plan todo 22).
    pub remote_screens: BTreeMap<u32, crate::remote_impl::FakeRemoteScreen>,
}

impl Default for FakeScenario {
    fn default() -> Self {
        Self {
            displays: Vec::new(),
            windows: Vec::new(),
            capabilities: fake_capabilities(0),
            ax: BTreeMap::new(),
            menus: BTreeMap::new(),
            ax_owner_unknown: false,
            user_input_feed: true,
            cursor: default_cursor(),
            capture_color: DEFAULT_CAPTURE_COLOR,
            delay_ms: DelayMs::default(),
            resize_window: None,
            fail_next: Vec::new(),
            user_presses: Vec::new(),
            ax_cannot_complete: Vec::new(),
            legacy_capture: false,
            remote_screens: BTreeMap::new(),
        }
    }
}

impl FakeScenario {
    pub fn from_json(json: &str) -> Result<Self, ScenarioError> {
        serde_json::from_str(json).map_err(ScenarioError::Parse)
    }

    pub fn load(path: &Path) -> Result<Self, ScenarioError> {
        let json = std::fs::read_to_string(path).map_err(|source| ScenarioError::Read {
            path: path.to_path_buf(),
            source,
        })?;
        Self::from_json(&json)
    }
}

/// Capabilities of a fully capable fake host before any scenario overlay.
pub fn fake_capabilities(display_count: u32) -> DesktopCapabilities {
    DesktopCapabilities {
        backend: "fake".to_string(),
        display_server: None,
        capture: true,
        input: true,
        ax: true,
        background_window_input: true,
        delivery_modes: vec!["background".to_string(), "foreground".to_string()],
        capture_permission: "granted".to_string(),
        input_permission: "granted".to_string(),
        ax_permission: "granted".to_string(),
        display_count,
        focus_guard: true,
        ..DesktopCapabilities::unavailable()
    }
}

/// Artificial latency before a call runs: one value for every method, or a
/// per-method map (`{"capture": 5000}`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum DelayMs {
    Every(u64),
    PerMethod(BTreeMap<FakeMethod, u64>),
}

impl Default for DelayMs {
    fn default() -> Self {
        Self::PerMethod(BTreeMap::new())
    }
}

impl DelayMs {
    pub fn for_method(&self, method: FakeMethod) -> Option<Duration> {
        let ms = match self {
            Self::Every(ms) => Some(*ms),
            Self::PerMethod(per_method) => per_method.get(&method).copied(),
        };
        ms.filter(|ms| *ms > 0).map(Duration::from_millis)
    }
}

/// After the next capture of window `id`, the window takes this size, so a
/// pointer mapped through the old frame hits `InvalidCoordinateFrame`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResizeWindow {
    pub id: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScriptedFailure {
    pub method: FakeMethod,
    pub code: ErrorCode,
    /// `CaptureUnavailable` reason token, e.g. `"minimized"`.
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ScenarioError {
    #[error("cannot read fake scenario {path}: {source}")]
    Read { path: PathBuf, source: std::io::Error },
    #[error("invalid fake scenario: {0}")]
    Parse(serde_json::Error),
    #[error("unknown capability field '{0}' in fake scenario")]
    UnknownCapability(String),
    #[error("fake scenario references unknown window '{0}'")]
    UnknownWindow(String),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawScenario {
    #[serde(default)]
    displays: Vec<DesktopDisplay>,
    #[serde(default)]
    windows: Vec<DesktopWindow>,
    #[serde(default)]
    capabilities: Map<String, Value>,
    #[serde(default)]
    ax: BTreeMap<String, FakeAxNode>,
    #[serde(default)]
    menus: BTreeMap<String, Vec<FakeMenuNode>>,
    #[serde(default)]
    ax_owner_unknown: bool,
    #[serde(default = "default_cursor")]
    cursor: Option<DesktopPoint>,
    #[serde(default = "default_capture_color")]
    capture_color: [u8; 4],
    #[serde(default)]
    delay_ms: DelayMs,
    #[serde(default)]
    resize_window: Option<ResizeWindow>,
    #[serde(default)]
    fail_next: Vec<ScriptedFailure>,
    #[serde(default)]
    user_presses: Vec<crate::user_input_impl::ScriptedUserPress>,
    #[serde(default = "crate::scenario_nodes::enabled_by_default")]
    user_input_feed: bool,
    #[serde(default)]
    ax_cannot_complete: Vec<AxWrite>,
    #[serde(default)]
    legacy_capture: bool,
    #[serde(default)]
    remote_screens: BTreeMap<u32, crate::remote_impl::FakeRemoteScreen>,
}

impl TryFrom<RawScenario> for FakeScenario {
    type Error = ScenarioError;

    fn try_from(raw: RawScenario) -> Result<Self, Self::Error> {
        let known = |id: &String| raw.windows.iter().any(|window| &window.id == id);
        let mut referenced = raw
            .ax
            .keys()
            .chain(raw.menus.keys())
            .chain(raw.resize_window.iter().map(|resize| &resize.id));
        if let Some(unknown) = referenced.find(|id| !known(id)) {
            return Err(ScenarioError::UnknownWindow(unknown.clone()));
        }
        let display_count = u32::try_from(raw.displays.len()).unwrap_or(u32::MAX);
        let capabilities = overlay_capabilities(fake_capabilities(display_count), raw.capabilities)?;
        Ok(Self {
            displays: raw.displays,
            windows: raw.windows,
            capabilities,
            ax: raw.ax,
            menus: raw.menus,
            ax_owner_unknown: raw.ax_owner_unknown,
            cursor: raw.cursor,
            capture_color: raw.capture_color,
            delay_ms: raw.delay_ms,
            resize_window: raw.resize_window,
            fail_next: raw.fail_next,
            user_presses: raw.user_presses,
            user_input_feed: raw.user_input_feed,
            ax_cannot_complete: raw.ax_cannot_complete,
            legacy_capture: raw.legacy_capture,
            remote_screens: raw.remote_screens,
        })
    }
}

fn overlay_capabilities(
    base: DesktopCapabilities,
    overlay: Map<String, Value>,
) -> Result<DesktopCapabilities, ScenarioError> {
    let mut fields = serde_json::to_value(base).map_err(ScenarioError::Parse)?;
    for (key, value) in overlay {
        let Some(slot) = fields.get_mut(&key) else {
            return Err(ScenarioError::UnknownCapability(key));
        };
        *slot = value;
    }
    serde_json::from_value(fields).map_err(ScenarioError::Parse)
}

const fn default_cursor() -> Option<DesktopPoint> {
    Some(DesktopPoint { x: 0.0, y: 0.0 })
}

const fn default_capture_color() -> [u8; 4] {
    DEFAULT_CAPTURE_COLOR
}
