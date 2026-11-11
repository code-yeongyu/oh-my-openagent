//! The hand-side audit (RED stub: signatures only).

mod chain;
pub mod gc;
mod line;
mod memory;
mod redact;
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
pub use redact::{keys, text, KeysRecord};
pub use sink::{AuditSink, UnavailableAudit, AUDIT_UNAVAILABLE};
pub use writer::{audit_path, Anchor, AuditLimits, AuditWriter, WriterId, AUDIT_FILE, ROTATED_FILE};
