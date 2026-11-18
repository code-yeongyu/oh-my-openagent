//! The v1 reply shapes the corpus pins; null-mode sessions keep them byte for byte.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::capabilities::{Capabilities, LegacyCapabilities};
use crate::listing::Rect;

/// `capabilities`: the v1 record in null mode, the object-mode record otherwise.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum CapabilitiesReply {
    Legacy(Box<LegacyCapabilities>),
    Object(Box<Capabilities>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionOpened {
    pub capabilities: CapabilitiesReply,
    pub resume_token: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureMode {
    InlinePng,
    ArtifactOnly,
}

/// The v1 frame reply of `capture`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyFrame {
    pub mode: CaptureMode,
    pub data: Option<String>,
    pub mime_type: String,
    pub artifact_path: Option<String>,
    pub width: u32,
    pub height: u32,
    pub source_width: u32,
    pub source_height: u32,
    pub coordinate_width: u32,
    pub coordinate_height: u32,
    pub region: Option<Rect>,
    pub scale: f64,
    pub target: String,
    pub frame_id: String,
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legacy_capture: Option<bool>,
}

/// The v1 `observe` reply: a frame plus the accessibility summary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyObservation {
    pub mode: CaptureMode,
    pub data: Option<String>,
    pub mime_type: String,
    pub artifact_path: Option<String>,
    pub width: u32,
    pub height: u32,
    pub source_width: u32,
    pub source_height: u32,
    pub coordinate_width: u32,
    pub coordinate_height: u32,
    pub region: Option<Rect>,
    pub scale: f64,
    pub target: String,
    pub frame_id: String,
    pub note: Option<String>,
    pub ax: String,
    pub node_count: u32,
    pub truncated: bool,
}

/// One v1 `windows` record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyWindow {
    pub id: String,
    pub title: String,
    pub app: String,
    pub pid: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub focused: bool,
    pub elevated: Option<bool>,
}

/// The v1 accessibility snapshot: the rendered tree text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AxSnapshotText {
    pub text: String,
    pub node_count: u32,
    pub truncated: bool,
}

/// One v1 accessibility node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AxNode {
    #[serde(rename = "ref")]
    pub reference: String,
    pub role: String,
    pub native_role: Option<String>,
    pub title: Option<String>,
    pub value: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
    pub focused: bool,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub actions: Vec<String>,
    pub child_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum TypeTextMethod {
    Inserted,
    Keys,
}

/// `ax.typeText`: how the text went in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AxTypeTextReply {
    pub method: TypeTextMethod,
}

/// The stop path's state (`stopPath.*` replies and the `stopPath.changed` notification).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StopPathStatus {
    pub suspended: bool,
    pub global_live: bool,
    pub host_relay_live: bool,
    pub heartbeat_fresh: bool,
    pub stop_path: String,
    pub reason: Option<String>,
}

/// The foreground-control grant (`control.grant`, `control.acquire`, `control.changed`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlState {
    pub active: bool,
    pub reason: Option<String>,
    pub granted_at: Option<String>,
}
