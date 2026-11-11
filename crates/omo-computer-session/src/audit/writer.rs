//! The per-hand audit writer (RED stub: writes nothing).

use std::io;
use std::path::{Path, PathBuf};

use omo_computer_core::backend::Refusal;

use super::line::AuditEvent;
use super::sink::AuditSink;

pub const AUDIT_FILE: &str = "audit.jsonl";
pub const ROTATED_FILE: &str = "audit.1.jsonl";

#[must_use]
pub fn audit_path(audit_dir: &Path, hand_id: &str) -> PathBuf {
    audit_dir.join("computer").join(hand_id).join(AUDIT_FILE)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WriterId {
    pub pid: u32,
    pub proc_start_ms: u64,
}

impl WriterId {
    #[must_use]
    pub fn current() -> Self {
        Self { pid: std::process::id(), proc_start_ms: 0 }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AuditLimits {
    pub rotate_at: u64,
    pub hard_cap: u64,
    pub max_event: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Anchor {
    pub fingerprint: String,
    pub suspended: bool,
    pub stop_epoch: u64,
}

#[derive(Debug)]
pub struct AuditWriter {
    path: PathBuf,
}

impl AuditWriter {
    /// # Errors
    /// Never (stub).
    pub fn open(audit_dir: &Path, hand_id: &str, _generation: u64, _writer: WriterId, _limits: AuditLimits) -> io::Result<Self> {
        Ok(Self { path: audit_path(audit_dir, hand_id) })
    }

    /// # Errors
    /// Never (stub).
    pub fn open_authority(audit_dir: &Path, hand_id: &str, generation: u64, writer: WriterId, limits: AuditLimits, _anchor: Anchor) -> io::Result<Self> {
        Self::open(audit_dir, hand_id, generation, writer, limits)
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl AuditSink for AuditWriter {
    fn admit(&self) -> Result<(), Refusal> {
        Ok(())
    }

    fn append(&mut self, _event: AuditEvent) -> io::Result<String> {
        Ok(String::new())
    }

    fn path(&self) -> Option<&Path> {
        Some(&self.path)
    }
}
