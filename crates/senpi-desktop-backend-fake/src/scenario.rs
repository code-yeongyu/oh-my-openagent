//! The JSON scenario format a fake backend serves.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::{DesktopCapabilities, DesktopDisplay, DesktopPoint, DesktopWindow};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::method::FakeMethod;

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
    /// Global cursor position; `None` models a backend without cursor access.
    pub cursor: Option<DesktopPoint>,
    /// RGBA fill of every captured image.
    pub capture_color: [u8; 4],
    pub delay_ms: DelayMs,
    pub resize_window: Option<ResizeWindow>,
    /// Failures queued at load time, as if `fail_next` had been called.
    pub fail_next: Vec<ScriptedFailure>,
}

impl Default for FakeScenario {
    fn default() -> Self {
        Self {
            displays: Vec::new(),
            windows: Vec::new(),
            capabilities: fake_capabilities(0),
            ax: BTreeMap::new(),
            cursor: default_cursor(),
            capture_color: DEFAULT_CAPTURE_COLOR,
            delay_ms: DelayMs::default(),
            resize_window: None,
            fail_next: Vec::new(),
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScriptedFailure {
    pub method: FakeMethod,
    pub code: ErrorCode,
}

/// One scripted accessibility element and its subtree.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FakeAxNode {
    pub role: String,
    /// Platform role; defaults to `role`.
    #[serde(default)]
    pub native_role: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    #[serde(default)]
    pub focused: bool,
    /// Global logical bounds.
    #[serde(default)]
    pub bounds: Option<FakeBounds>,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub children: Vec<FakeAxNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FakeBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
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
}

impl TryFrom<RawScenario> for FakeScenario {
    type Error = ScenarioError;

    fn try_from(raw: RawScenario) -> Result<Self, Self::Error> {
        let known = |id: &String| raw.windows.iter().any(|window| &window.id == id);
        let mut referenced = raw
            .ax
            .keys()
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
            cursor: raw.cursor,
            capture_color: raw.capture_color,
            delay_ms: raw.delay_ms,
            resize_window: raw.resize_window,
            fail_next: raw.fail_next,
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

const fn enabled_by_default() -> bool {
    true
}
