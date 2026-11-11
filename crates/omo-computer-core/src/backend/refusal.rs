//! The typed refusal every default backend method answers with. Nothing is sent on a
//! refusal: a default never reaches the OS.

use crate::error::{self, ComputerCode, EngineCode, ErrorRow, UnknownFailure};

/// A refusal before any send: `nothingSent` is always true. `code` is one of the closed
/// engine codes and `reason` its `data.reason` token, or `None` for a bare refusal; the
/// pair maps to its `COMPUTER_*` row through the one error table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    pub code: EngineCode,
    pub reason: Option<&'static str>,
}

impl Refusal {
    /// A refusal carrying `reason` as its `data.reason`.
    #[must_use]
    pub const fn new(code: EngineCode, reason: &'static str) -> Self {
        Self {
            code,
            reason: Some(reason),
        }
    }

    /// A refusal with no `data.reason`: it resolves to the code's bare row.
    #[must_use]
    pub const fn bare(code: EngineCode) -> Self {
        Self { code, reason: None }
    }

    /// The table row of `(code, reason)`, or the code's bare row when there is no reason.
    ///
    /// # Errors
    /// `UnknownFailure` when the reason token or the pair has no row.
    pub fn row(&self) -> Result<&'static ErrorRow, UnknownFailure> {
        error::from_wire(self.code.number(), self.reason)
    }

    /// The `COMPUTER_*` member the tool and the adapter show.
    ///
    /// # Errors
    /// `UnknownFailure` when the pair has no row.
    pub fn computer_code(&self) -> Result<ComputerCode, UnknownFailure> {
        self.row().map(|row| row.computer)
    }
}

/// The result of every fallible backend method.
pub type BackendResult<T> = Result<T, Refusal>;
