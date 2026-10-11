use std::path::PathBuf;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DesktopDisplay;

/// Inline screenshot byte budget used when the host sends no `maxBytes`.
pub const DEFAULT_CAPTURE_MAX_BYTES: u64 = 5_000_000;

/// One encoded capture inside the engine. `data` holds the PNG bytes and never
/// crosses the wire; `CaptureResult` is the wire form.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCapture {
    #[serde(skip)]
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// Pre-scaling capture width in native pixels; equals `width` when unscaled.
    pub source_width: u32,
    /// Pre-scaling capture height in native pixels; equals `height` when
    /// unscaled.
    pub source_height: u32,
    pub target: String,
    pub displays: Vec<DesktopDisplay>,
    pub backend: String,
    pub display_server: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct CaptureCaps {
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    /// Clamp to the coordinate-safe size for models that click in image pixels.
    pub coordinate_safe: bool,
    /// Inline byte budget; above it the capture degrades to JPEG, then artifact-only.
    pub max_bytes: u64,
}

impl Default for CaptureCaps {
    fn default() -> Self {
        Self {
            max_width: None,
            max_height: None,
            coordinate_safe: false,
            max_bytes: DEFAULT_CAPTURE_MAX_BYTES,
        }
    }
}

/// How a capture was delivered under the byte budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureMode {
    InlinePng,
    InlineJpeg,
    ArtifactOnly,
}

/// The wire result of `capture`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub mode: CaptureMode,
    /// Base64 image bytes when `mode` is inline.
    pub data: Option<String>,
    pub mime_type: Option<String>,
    pub artifact_path: Option<PathBuf>,
    pub width: u32,
    pub height: u32,
    pub source_width: u32,
    pub source_height: u32,
    pub scale: f64,
    pub target: String,
    pub frame_id: String,
    pub note: Option<String>,
}
