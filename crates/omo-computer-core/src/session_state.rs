//! `SessionState`: the live lock / display-sleep / user-active / Secure Input /
//! console / saver state stamped on every object-mode reply (principle 4).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The literal `"unknown"`: the OS gave no answer, which never refuses and is reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum UnknownLiteral {
    #[serde(rename = "unknown")]
    Unknown,
}

/// `boolean | "unknown"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum Tristate {
    Known(bool),
    Unknown(UnknownLiteral),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserActive {
    pub active: Tristate,
    pub last_input_age_ms: Option<u64>,
}

/// The four reasons a session reports; `screen_locked` and `system_suspended` pause.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionPauseReason {
    ScreenLocked,
    ScreensaverActive,
    SessionDeactivated,
    SystemSuspended,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionState {
    pub screen_locked: Tristate,
    pub display_asleep: Tristate,
    pub user_active: UserActive,
    pub secure_input_active: Tristate,
    pub session_active: Tristate,
    pub screensaver_active: Tristate,
    pub pause_reasons: Vec<SessionPauseReason>,
    pub sampled_at: u64,
}
