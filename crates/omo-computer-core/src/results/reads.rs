//! Replies of the read methods: the mode unions of v1 methods and the new read replies.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::v1::{LegacyFrame, LegacyObservation, LegacyWindow};
use crate::listing::{ElementInfo, Rect, WindowInfo};
use crate::observation::{Frame, Observation};
use crate::untrusted::UntrustedText;

/// `capture` / `zoom`: the v1 frame in null mode, a `Frame` in object mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum CaptureReply {
    Legacy(Box<LegacyFrame>),
    Object(Box<Frame>),
}

/// `observe`: the v1 frame-plus-summary in null mode, an `Observation` in object mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum ObserveReply {
    Legacy(Box<LegacyObservation>),
    Object(Box<Observation>),
}

/// `windows`: the v1 records in null mode, `WindowInfo` records in object mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum WindowsReply {
    Legacy(Vec<LegacyWindow>),
    Object(Vec<WindowInfo>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayInfo {
    pub id: String,
    pub bounds: Rect,
    pub scale: f64,
    pub primary: bool,
    /// A display was dropped from the composite.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
}

/// `pointer`: the pointer position in desktop coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PointerPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum ConcealedReason {
    #[serde(rename = "concealed")]
    Concealed,
}

/// `clipboard.read`: a concealed clipboard answers `{secure:true, text:null, reason:"concealed"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipboardContent {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "crate::nullable"
    )]
    #[schemars(with = "Option<String>")]
    pub text: Option<Option<String>>,
    pub formats: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<bool>", extend("const" = true))]
    pub secure: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<ConcealedReason>,
    pub observation: UntrustedText,
}

/// `menu.items`: the menu tree, listed without opening, moving or focusing anything.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MenuItems {
    pub items: Vec<ElementInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
    pub observation: UntrustedText,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum WaitOutcome {
    Settled,
    Pending,
    Unsupported,
    Matched,
    Timeout,
}

/// `waitFor`: the outcome and the observation it ended on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WaitResult {
    pub outcome: WaitOutcome,
    pub observation: Box<Observation>,
}
