//! The v1 capability record, the shape null-mode sessions keep seeing byte for byte.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DeliveryMode {
    Background,
    Foreground,
}

/// `capabilities` (and `session.open`'s `capabilities` member) in null mode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LegacyCapabilities {
    pub backend: String,
    pub display_server: Option<String>,
    pub capture: bool,
    pub input: bool,
    pub ax: bool,
    pub background_window_input: bool,
    pub cursor_overlay: bool,
    pub delivery_modes: Vec<DeliveryMode>,
    pub capture_permission: String,
    pub input_permission: String,
    pub ax_permission: String,
    pub display_count: u32,
    pub focus_guard: bool,
    pub stop_path: String,
    pub stop_reason: Option<String>,
    pub integrity_level: Option<String>,
    pub screen_locked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_asleep: Option<bool>,
}
