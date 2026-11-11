//! The grouped numeric settings: `run_limits`, `fleet` and `mcp`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::values::Tier;

/// `run_limits`: the QuickJS cell's ceilings. Every member is overridable per hand; an
/// omitted member keeps its default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct RunLimits {
    pub source: u64,
    pub wall_ms: u64,
    pub heap_bytes: u64,
    pub stack_bytes: u64,
    pub calls: u64,
    pub pending: u64,
    pub arg_bytes: u64,
    pub return_bytes: u64,
    pub tree_bytes: u64,
    pub image_bytes: u64,
    pub journal: u64,
    pub children: u64,
    pub batch_calls: u64,
}

impl Default for RunLimits {
    fn default() -> Self {
        Self {
            source: 65_536,
            wall_ms: 30_000,
            heap_bytes: 16_777_216,
            stack_bytes: 1_048_576,
            calls: 64,
            pending: 4,
            arg_bytes: 65_536,
            return_bytes: 65_536,
            tree_bytes: 131_072,
            image_bytes: 2_097_152,
            journal: 64,
            children: 4,
            batch_calls: 16,
        }
    }
}

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
