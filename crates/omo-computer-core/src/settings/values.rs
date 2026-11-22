//! Value types of the `computer.*` settings table.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The literal `"full"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum FullLiteral {
    #[serde(rename = "full")]
    Full,
}

/// `trace`: `false | true | "full"`. `true` writes the JSONL trace only; `"full"` adds the
/// session manifest and the per-turn artifacts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum Trace {
    Enabled(bool),
    Full(FullLiteral),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Intervention {
    Continue,
    Pause,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CuaAdapterMode {
    Auto,
    On,
    Off,
}

/// `cua_adapter`: the tri-state, plus the old boolean read as `on` / `off` for two minor releases.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum CuaAdapter {
    Mode(CuaAdapterMode),
    Coerced(bool),
}

/// The tool tier the `--mcp` shim grants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Read,
    Exec,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum LinuxDisplayServer {
    Auto,
    X11,
    Wayland,
}

/// The four toolkit route classes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolkitClass {
    CanvasGl,
    ChromiumElectron,
    PointerHw,
    QtXcb,
}

/// `computer.runtime` (amendment A10): which implementation serves the tool until cutover.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Runtime {
    Legacy,
    V3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum AppScopeMode {
    List,
    Off,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AppScope {
    pub mode: AppScopeMode,
    pub allow: Vec<String>,
    pub denied: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SendOnEnterRule {
    pub chords: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SshHost {
    pub host: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

/// `default_hand`: `"local"`, `"relay:<id>"`, `"bunshin:<id>"`, `"ssh:<alias>"`, `{handId}` or `{name}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum HandSelector {
    Spec(String),
    Id {
        #[serde(rename = "handId")]
        hand_id: String,
    },
    Name {
        name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturePolicyRow {
    pub pattern: String,
    pub max_long_edge_px: u32,
    pub max_image_tokens: u32,
    pub supports_image_detail_original: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AuditLog {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ScreenshotGc {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stale_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scan_interval_ms: Option<u64>,
}

/// Exact-key tables: a key matches one bundle id / AUMID / `WM_CLASS` / `app_id`, never a substring.
pub type ExactKeyTable<T> = BTreeMap<String, T>;
