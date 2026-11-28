use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CursorTraceAction {
    Idle,
    Navigate,
    Click,
    Drag,
    Scroll,
    Text,
    Key,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CursorTraceFrame {
    pub t_ms: u64,
    pub x: f64,
    pub y: f64,
    pub display: String,
    pub action: CursorTraceAction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CursorTrace {
    /// Drawn frames in chronological order, newest last.
    #[schemars(length(max = 2000))]
    pub frames: Vec<CursorTraceFrame>,
    pub dropped: u64,
}
