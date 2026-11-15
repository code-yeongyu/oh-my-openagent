//! The grouped numeric settings: `fleet` and `mcp`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::values::Tier;

/// `fleet`: the brain-side fanout budgets. `maxInFlight` is the fanout concurrency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FleetSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_in_flight: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_bytes_per_min: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub per_hand_frames_per_sec: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_image_parts_per_result: Option<u32>,
}

/// `mcp`: the `--mcp` shim's consent view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct McpSettings {
    pub tier: Tier,
}
