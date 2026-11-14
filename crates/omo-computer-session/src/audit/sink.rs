//! Where the funnel's audit events go, and the fail-closed admission rule: an exec whose
//! line cannot be written is refused `Internal{audit_unavailable}` (`COMPUTER_AUDIT_UNAVAILABLE`)
//! with nothing sent, while reads go on.

use std::io;
use std::path::{Path, PathBuf};

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use super::line::AuditEvent;

/// `Unavailable{reason:"audit_unavailable"}`: the `Internal` row keyed by its reason.
pub const AUDIT_UNAVAILABLE: Refusal =
    Refusal::new(EngineCode::Internal, Reason::AuditUnavailable.wire());

pub trait AuditSink: Send {
    /// Admission: `Ok` while the next line can be written.
    ///
    /// # Errors
    /// [`AUDIT_UNAVAILABLE`].
    fn admit(&self) -> Result<(), Refusal>;

    /// Appends one line and answers its `lineHash`. A failure degrades the sink: every
    /// later admission refuses until it is writable again.
    ///
    /// # Errors
    /// The line could not be appended.
    fn append(&mut self, event: AuditEvent) -> io::Result<String>;

    /// The audit file, when there is one.
    fn path(&self) -> Option<&Path>;
}

/// The audit of an engine whose per-hand file could not be opened: every exec refuses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnavailableAudit {
    path: PathBuf,
}

impl UnavailableAudit {
    #[must_use]
    pub const fn at(path: PathBuf) -> Self {
        Self { path }
    }
}

impl AuditSink for UnavailableAudit {
    fn admit(&self) -> Result<(), Refusal> {
        Err(AUDIT_UNAVAILABLE)
    }

    fn append(&mut self, _event: AuditEvent) -> io::Result<String> {
        Err(io::Error::other("the audit file is unavailable"))
    }

    fn path(&self) -> Option<&Path> {
        Some(&self.path)
    }
}
