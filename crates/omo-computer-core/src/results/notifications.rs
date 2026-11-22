//! Params of the engine-to-host notifications (pushed, 500 ms idle flush).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// One `audit` line as v1 hosts read it. Text is recorded by length and digest only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuditLine {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub action: String,
    pub target: String,
    pub delivery: String,
    pub frame_id: Option<String>,
    pub code: Option<String>,
    pub duration_ms: u64,
    pub focus_restored: Option<bool>,
    pub text_length: Option<u64>,
    pub text_sha256: Option<String>,
    pub keys: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_delivered: Option<u64>,
}

/// `epoch.changed`: the frames and refs of an older epoch are stale.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EpochChanged {
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ForegroundConsent {
    Never,
    Policy,
    Granted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandConsent {
    pub computer_use: bool,
    pub remote_commands: bool,
    pub foreground: ForegroundConsent,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_scope: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tampered: Option<bool>,
}

/// `hand.status`: liveness of the hand the host serves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct HandStatus {
    pub online: bool,
    pub generation: u64,
    pub stopped: bool,
    pub consent: HandConsent,
}
