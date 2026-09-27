//! Engine wire types (camelCase JSON) and their parsed in-engine forms.

use std::path::PathBuf;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

mod ax;
mod capture;
mod display;
mod window;

pub use ax::{AxNode, AxQuery, AxSnapshot, AxSnapshotOptions};
pub use capture::{CaptureCaps, CaptureMode, CaptureResult, DesktopCapture, DEFAULT_CAPTURE_MAX_BYTES};
pub use display::{DesktopCapabilities, DesktopDisplay, DisplaySelector};
pub use window::{DesktopPoint, DesktopWindow, FrontWindow, PointerOptions, Target};

/// `session.open` parameters supplied by the host.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct DesktopSessionOptions {
    pub display: Option<String>,
    /// Accept a heartbeating host relay as the only stop path.
    pub allow_host_relay_only_stop: bool,
    /// Audit JSONL file; `None` turns auditing off.
    pub audit_path: Option<PathBuf>,
    /// Directory for artifact-only screenshots.
    pub artifact_dir: Option<PathBuf>,
    pub screenshot_gc: ScreenshotGc,
    pub capture_caps: CaptureCaps,
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
