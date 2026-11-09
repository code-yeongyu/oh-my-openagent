//! Engine wire types (camelCase JSON) and their parsed in-engine forms.

use std::path::PathBuf;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::report::ReportMode;

mod ax;
mod capture;
mod display;
mod window;

pub use ax::{AxCut, AxEvidence, AxNode, AxQuery, AxSnapshot, AxSnapshotOptions, EvidenceState};
pub use capture::{CaptureCaps, CaptureMode, CaptureRegion, CaptureResult, DesktopCapture, ObserveResult, DEFAULT_CAPTURE_MAX_BYTES};
pub use display::{
    DesktopCapabilities, DesktopDisplay, DisplaySelector, InterventionWatch, ScreenState, WindowInput,
};
pub use window::{DesktopPoint, DesktopWindow, FrontWindow, PointerOptions, Target, WindowIdentity};

/// `session.open` parameters supplied by the host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct DesktopSessionOptions {
    pub display: Option<String>,
    pub macos_canary: MacosCanaryMode,
    /// Display-only virtual cursor; never changes input admission.
    #[serde(default = "default_show_cursor")]
    #[schemars(default = "default_show_cursor")]
    pub show_cursor: bool,
    /// Accept a heartbeating host relay as the only stop path.
    pub allow_host_relay_only_stop: bool,
    /// Audit JSONL file; `None` turns auditing off.
    pub audit_path: Option<PathBuf>,
    /// Directory for artifact-only screenshots.
    pub artifact_dir: Option<PathBuf>,
    pub screenshot_gc: ScreenshotGc,
    pub capture_caps: CaptureCaps,
    /// `object` makes every mutating request return an `ActionReport` and its
    /// errors carry `disposition`; send it only to an engine whose
    /// `engine.hello` lists `action-report`.
    pub report_mode: ReportMode,
    /// What a background action does when the user is using the target app.
    pub intervention: InterventionPolicy,
    /// macOS background key priming; accepted and stored, not acted on yet.
    pub macos_key_priming: KeyPriming,
    /// Per-request timing traces; accepted and stored, not acted on yet.
    pub trace: bool,
}

/// What a background action does when the user is using the target app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum InterventionPolicy {
    Continue,
    #[default]
    Pause,
}

/// Whether macOS background keys first make the target window key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum KeyPriming {
    On,
    #[default]
    Off,
}

const fn default_show_cursor() -> bool {
    true
}

impl Default for DesktopSessionOptions {
    fn default() -> Self {
        Self {
            display: None,
            macos_canary: MacosCanaryMode::default(),
            show_cursor: default_show_cursor(),
            allow_host_relay_only_stop: false,
            audit_path: None,
            artifact_dir: None,
            screenshot_gc: ScreenshotGc::default(),
            capture_caps: CaptureCaps::default(),
            report_mode: ReportMode::default(),
            intervention: InterventionPolicy::default(),
            macos_key_priming: KeyPriming::default(),
            trace: false,
        }
    }
}

/// Whether macOS verifies background delivery before the session's first input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum MacosCanaryMode {
    #[default]
    Session,
    Off,
}

/// Screenshot artifact garbage-collection knobs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct ScreenshotGc {
    pub stale_ms: u64,
    pub scan_interval_ms: u64,
}

impl Default for ScreenshotGc {
    fn default() -> Self {
        Self {
            stale_ms: 43_200_000,
            scan_interval_ms: 1_800_000,
        }
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod display_tests;
