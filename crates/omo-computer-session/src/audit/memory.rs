//! The audit of a session with no STATE root: the same stamping and chain, kept in memory.

use std::io;
use std::path::Path;

use omo_computer_core::backend::Refusal;
use serde_json::Value;

use super::line::AuditEvent;
use super::segment::{stamp, Segment};
use super::sink::AuditSink;

#[derive(Debug, Clone)]
pub struct MemoryAudit {
    segment: Segment,
    lines: Vec<Value>,
}

impl MemoryAudit {
    #[must_use]
    pub fn new(hand_id: &str, generation: u64) -> Self {
        let segment = Segment::new(hand_id, generation, super::WriterId::current());
        let lines = vec![segment.meta()];
        Self { segment, lines }
    }

    /// Every line so far, `audit.meta` first.
    #[must_use]
    pub fn lines(&self) -> &[Value] {
        &self.lines
    }
}

impl AuditSink for MemoryAudit {
    fn admit(&self) -> Result<(), Refusal> {
        Ok(())
    }

    fn append(&mut self, event: AuditEvent) -> io::Result<String> {
        let line = stamp(&mut self.segment, &event)?;
        let hash = self.segment.prev.clone();
        self.lines.push(line);
        Ok(hash)
    }

    fn path(&self) -> Option<&Path> {
        None
    }
}
