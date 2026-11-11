//! The in-memory audit (RED stub).

use std::io;
use std::path::Path;

use omo_computer_core::backend::Refusal;

use super::line::AuditEvent;
use super::sink::AuditSink;

#[derive(Debug, Clone, Default)]
pub struct MemoryAudit;

impl MemoryAudit {
    #[must_use]
    pub const fn new(_hand_id: &str, _generation: u64) -> Self {
        Self
    }
}

impl AuditSink for MemoryAudit {
    fn admit(&self) -> Result<(), Refusal> {
        Ok(())
    }

    fn append(&mut self, _event: AuditEvent) -> io::Result<String> {
        Ok(String::new())
    }

    fn path(&self) -> Option<&Path> {
        None
    }
}
