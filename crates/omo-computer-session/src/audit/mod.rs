//! The hand-side audit: one redacted JSONL file per hand with per-writer segments, the
//! per-segment hash chain, fail-closed admission, and the bounded artifact retention.

mod chain;
pub mod gc;
mod line;
mod memory;
mod redact;
mod segment;
mod sink;
mod writer;

#[cfg(test)]
mod tests;

pub use chain::{line_hash, sha256_16};
pub use line::{
    now_ms, rfc3339_ms, AuditEvent, AuditLatch, Consent, DeliveredRecord, DeliveryKind,
    DispositionRecord, Gate, GateOutcome, Grant, GrantKind, GrantVerdict, Status, TextRecord, Tier,
    Warning,
};
pub use memory::MemoryAudit;
pub use redact::{keys, text, truncate, KeysRecord};
pub use sink::{AuditSink, UnavailableAudit, AUDIT_UNAVAILABLE};
pub use writer::{
    audit_path, Anchor, AuditLimits, AuditWriter, WriterId, AUDIT_FILE, ROTATED_FILE,
};
