//! `AuditLine` v2: the caller's `AuditEvent`, stamped by the writer with `v`, `ts`, the
//! hand, the writer segment key `(writerPid, writerProcStartMs, seq)`, `prev` and
//! `lineHash`. Every enum is closed. Text is `{length, sha256_16}`, or `{length}` only
//! under the secure predicate; typed text and clipboard contents never appear.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Text, pasted text or clipboard contents as the audit, the trace and the marker keep it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextRecord {
    pub length: usize,
    /// Absent under the secure predicate: a digest of a short secret is a brute-force oracle.
    #[serde(default, rename = "sha256_16", skip_serializing_if = "Option::is_none")]
    pub sha256_16: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeliveryKind {
    #[default]
    Background,
    Foreground,
    Control,
    Stop,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Read,
    #[default]
    Exec,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GateOutcome {
    #[default]
    Admitted,
    Refused,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gate {
    pub outcome: GateOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DispositionRecord {
    pub delivery: String,
    pub retry: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrantKind {
    Tier,
    Foreground,
    AppScope,
    SafetyCheck,
    ConsentSave,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrantVerdict {
    Allow,
    Deny,
    ImpliedFullAccess,
    Config,
    RequireConfirmation,
    Block,
    RotationAnchor,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Consent {
    pub fingerprint: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLatch {
    pub suspended: bool,
    pub stop_epoch: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Grant {
    pub kind: GrantKind,
    pub verdict: GrantVerdict,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consent: Option<Consent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latch: Option<AuditLatch>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    #[default]
    Success,
    Error,
    Suspended,
    Refused,
}

/// The closed warning taxonomy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Warning {
    QuarantinedReply,
    WriteFailed,
    TruncatedLine,
    RedactedSecure,
    GenerationGap,
    ClockSkew,
    MarkerRecovered,
    ChainBroken,
    MirrorMismatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeliveredRecord {
    pub count: u32,
    pub of: u32,
}

/// One side effect or gate outcome, before the writer stamps it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    pub session_id: String,
    pub run_id: String,
    pub call_id: String,
    pub issuer: String,
    pub scope: String,
    pub action: String,
    pub target: String,
    pub delivery: DeliveryKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    pub tier: Tier,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_id: Option<String>,
    pub gate: Gate,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disposition: Option<DispositionRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivered: Option<DeliveredRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<TextRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keys: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clipboard: Option<TextRecord>,
    /// The marker's `issuedAt`: a marker with no matching line is a crash between marker and reply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marker_issued_at: Option<String>,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grant: Option<Grant>,
    pub status: Status,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_error: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<Warning>,
}

/// Milliseconds since the Unix epoch.
#[must_use]
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| u64::try_from(since.as_millis()).unwrap_or(u64::MAX))
}

/// RFC 3339 UTC with milliseconds (RED stub).
#[must_use]
pub fn rfc3339_ms(_unix_ms: u64) -> String {
    String::new()
}
