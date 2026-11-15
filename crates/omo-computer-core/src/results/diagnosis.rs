//! `diagnose`: the one doctor shape, model-visible here and user-visible through the doctor.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::capabilities::{ReleaseHelper, StopPathCapability};
use crate::session_state::SessionState;
use crate::untrusted::UntrustedText;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ChainRole {
    Host,
    Launcher,
    Engine,
    Helper,
}

/// One process of the spawn chain with its session context.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChainLink {
    pub role: ChainRole,
    pub pid: u32,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cdhash: Option<String>,
    pub session_context: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AttachVia {
    Direct,
    LauncherProxy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum PermissionState {
    Granted,
    Denied,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PermissionReport {
    pub state: PermissionState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relaunch_required: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum IdentityMatch {
    Match,
    Mismatch,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SpawnPath {
    OpenA,
    Disclaim,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct IdentityReport {
    #[serde(rename = "match")]
    pub matches: IdentityMatch,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<SpawnPath>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConsentAuthority {
    Host,
    FileOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Diagnosis {
    /// No probe failed.
    pub ok: bool,
    pub chain: Vec<ChainLink>,
    pub responsible_process: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attach_via: Option<AttachVia>,
    pub permissions: BTreeMap<String, PermissionReport>,
    pub identity: IdentityReport,
    pub consent_authority: ConsentAuthority,
    pub session: SessionState,
    pub lock_policy: String,
    pub stop_path: StopPathCapability,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_helper: Option<ReleaseHelper>,
    pub observation: UntrustedText,
}
