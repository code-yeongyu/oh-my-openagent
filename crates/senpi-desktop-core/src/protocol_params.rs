//! Engine method parameter shapes (camelCase JSON). Each method row in
//! `methods.rs` names exactly one of these (or a todo-3 core type).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::protocol::RequestId;
use crate::types::{AxQuery, AxSnapshotOptions, CaptureCaps, DesktopPoint, PointerOptions};

/// Parameters of a method that takes none: `{}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
pub struct EmptyParams {}

/// `capture`: one target (`desktop` or a window id) under optional caps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaptureParams {
    pub target: String,
    pub caps: Option<CaptureCaps>,
}

/// `click` / `moveMouse`: a point in the pixels of the target's latest frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PointParams {
    pub target: String,
    pub x: f64,
    pub y: f64,
    /// When present it must name the target's latest capture frame, otherwise
    /// the call fails `InvalidCoordinateFrame`.
    pub frame_id: Option<String>,
    pub opts: Option<PointerOptions>,
}

/// `drag`: a pointer path in the pixels of the target's latest frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DragParams {
    pub target: String,
    pub path: Vec<DesktopPoint>,
    pub frame_id: Option<String>,
    pub opts: Option<PointerOptions>,
}

/// `scroll`: wheel deltas at a point in the target's latest frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScrollParams {
    pub target: String,
    pub x: f64,
    pub y: f64,
    pub dx: f64,
    pub dy: f64,
    pub frame_id: Option<String>,
    pub opts: Option<PointerOptions>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TypeTextParams {
    pub target: String,
    pub text: String,
    pub opts: Option<PointerOptions>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct KeyChordParams {
    pub target: String,
    pub keys: Vec<String>,
    pub opts: Option<PointerOptions>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RaiseWindowParams {
    pub window_id: String,
}

/// `clipboard.write` params and `clipboard.read` result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardText {
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AxSnapshotParams {
    pub target: String,
    pub opts: Option<AxSnapshotOptions>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AxQueryParams {
    pub target: String,
    pub query: AxQuery,
}

/// `ax.elementAt`: hit-test at global logical desktop coordinates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AxElementAtParams {
    pub target: String,
    pub x: f64,
    pub y: f64,
}

/// An `eN` ref from `ax.snapshot` / `ax.query`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AxRefParams {
    #[serde(rename = "ref")]
    pub ref_: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AxPerformParams {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub action: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AxSetValueParams {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AxClickParams {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub opts: Option<PointerOptions>,
}

/// `stopPath.start`: the stop chord the Global listener arms, e.g.
/// `ctrl+alt+shift+escape`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StopPathStartParams {
    pub chord: String,
}

/// Who asked `stopPath.stop` to latch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum StopRequestSource {
    HostRelay,
    Api,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StopPathStopParams {
    pub source: StopRequestSource,
}

/// `stopPath.resume`: the per-process token only the `session.open` reply
/// carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct StopPathResumeParams {
    pub token: String,
}

/// `$/cancel`: aborts the pending request `id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct CancelParams {
    pub id: RequestId,
}

/// `$/test.advanceClock`: moves the injected fake clock forward.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct AdvanceClockParams {
    pub ms: u64,
}
