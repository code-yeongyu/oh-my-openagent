use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AxNode {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub role: String,
    pub native_role: String,
    pub title: Option<String>,
    pub value: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
    pub focused: bool,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub actions: Option<Vec<String>>,
    pub child_count: u32,
    /// How each field was obtained (object mode).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<AxEvidence>,
    /// The walk stopped above this node's children (object mode).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub subtree_truncated: bool,
    /// A secure text field: its value is never read (object mode).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub secure: bool,
}

/// `known`: read and present; `absent`: read and not there; `unknown`: not
/// read (timeout, error, or withheld for a secure field).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceState {
    Known,
    Absent,
    Unknown,
}

/// How each `AxNode` field was obtained.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AxEvidence {
    pub title: EvidenceState,
    pub value: EvidenceState,
    pub description: EvidenceState,
    pub enabled: EvidenceState,
    pub focused: EvidenceState,
    pub bounds: EvidenceState,
}

/// A node whose children the snapshot left out; its text line renders as
/// `[... <childCount> more]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AxCut {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub child_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AxSnapshot {
    pub text: String,
    pub node_count: u32,
    pub truncated: bool,
    /// The ref generation this snapshot registered (object mode).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<u64>,
    /// The generation this drill-down snapshot hangs under (object mode).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<u64>,
    /// Whether every node under the root was read (object mode).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub complete: Option<bool>,
    /// Nodes read, including those left out of `text` (object mode).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nodes_observed: Option<u32>,
    /// The nodes whose children were cut (object mode).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cuts: Vec<AxCut>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct AxSnapshotOptions {
    pub max_depth: Option<u32>,
    pub max_nodes: Option<u32>,
    pub all: Option<bool>,
    pub timeout_ms: Option<u64>,
    /// Only nodes changed since this generation.
    pub since: Option<u64>,
    /// Roles and refs only, no values.
    pub skeleton: Option<bool>,
    /// Snapshot only under this ref.
    pub root: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct AxQuery {
    pub role: Option<String>,
    pub title: Option<String>,
    pub value: Option<String>,
    pub limit: Option<u32>,
}
