//! The object-mode read replies of the interface block: `Frame` and `Observation`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::listing::{ElementInfo, Rect};
use crate::session_state::SessionState;
use crate::untrusted::UntrustedText;

/// Whose pointer the pixels carry: the OS one, one the engine composited, or none.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CursorMode {
    Os,
    Engine,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum ImageMime {
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/jpeg")]
    Jpeg,
}

/// Present only when the bytes did not ride inline (size above `limits.maxResponseBytes`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrameArtifact {
    pub digest: String,
    pub size: u64,
    pub mime: ImageMime,
    pub ttl_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Frame {
    pub frame_id: String,
    pub target: String,
    pub width: u32,
    pub height: u32,
    pub coordinate_width: u32,
    pub coordinate_height: u32,
    pub scale: f64,
    pub cursor: CursorMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact: Option<FrameArtifact>,
    pub session: SessionState,
    pub observation: UntrustedText,
}

/// A cut container the skeleton did not open; `drill(ref)` opens it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cut {
    #[serde(rename = "ref")]
    pub reference: String,
    pub child_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SettleOutcome {
    Settled,
    Pending,
    Unsupported,
    Timeout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum BusyIndicator {
    AxBusy,
    Progress,
    Spinner,
    FrameChanging,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservationSettle {
    pub outcome: SettleOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indicator: Option<BusyIndicator>,
    pub quiet_ms: u64,
    pub waited_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OcrLine {
    pub text: String,
    #[serde(rename = "box")]
    pub area: Rect,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Ocr {
    pub engine: String,
    pub languages: Vec<String>,
    pub lines: Vec<OcrLine>,
    pub truncated: bool,
    pub frame_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Observation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<Frame>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tree: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focused: Option<ElementInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
    pub complete: bool,
    pub nodes_observed: u32,
    pub cuts: Vec<Cut>,
    pub generation: u64,
    pub session: SessionState,
    pub observation: UntrustedText,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secure: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settle: Option<ObservationSettle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ocr: Option<Ocr>,
}
