//! Engine method results and server notification payloads that are not
//! already todo-3 core types.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::ErrorCode;
use crate::methods::Method;
use crate::types::DesktopCapabilities;

/// `engine.hello` handshake reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HelloResult {
    /// Always `PROTOCOL_VERSION`.
    pub protocol_version: String,
    pub engine_version: String,
    pub build_sha: String,
    /// Always `ABI`; a host refuses an engine whose ABI differs.
    pub abi: String,
}

/// `session.open` reply. `resume_token` is the only way to lift a stop latch
/// (`stopPath.resume`) and is never forwarded past the host process.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionOpenResult {
    pub capabilities: DesktopCapabilities,
    pub resume_token: String,
}

/// Which stop path currently guards input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum StopPathKind {
    Global,
    HostRelay,
    None,
}

/// `stopPath.*` reply and the `stopPath.changed` notification payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StopPathStatus {
    pub suspended: bool,
    pub global_live: bool,
    pub host_relay_live: bool,
    pub heartbeat_fresh: bool,
    pub stop_path: StopPathKind,
    /// Why input is not allowed, when it is not (e.g. `no-global-listener`,
    /// `heartbeat-stale`).
    pub reason: Option<String>,
}

/// The `audit` notification: one per mutating request, success or failure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    pub action: Method,
    pub target: String,
    /// `background` or `foreground`.
    pub delivery: String,
    pub frame_id: Option<String>,
    /// `None` when the request succeeded.
    pub code: Option<ErrorCode>,
    pub duration_ms: u64,
    pub focus_restored: Option<bool>,
    pub text_length: Option<u32>,
    /// First 16 hex digits of the typed text's SHA-256; the text itself is
    /// never audited.
    pub text_sha256: Option<String>,
    pub keys: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

/// The `engine.log` notification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct EngineLog {
    pub level: LogLevel,
    pub message: String,
}
