//! One row of the `COMPUTER_*` table and the typed lookups over it.

use std::fmt;

use crate::report::{Disposition, Retry};

use super::code::{ComputerCode, EngineCode};
use super::reason::{LayerFailure, Reason};
use super::table::rows;

/// Who raised the failure: an engine code of the closed table, or a layer outside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Source {
    Engine(EngineCode),
    Layer(LayerFailure),
}

/// The table key: `(engineCode, data.reason)`, or a layer failure and its reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct FailureKey {
    pub source: Source,
    pub reason: Option<Reason>,
}

/// The disposition a row emits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DispositionRule {
    /// Always this pair.
    Fixed(Disposition),
    /// One pair when nothing was sent, another once part of the input went out.
    BySent {
        nothing: Disposition,
        some: Disposition,
    },
    /// The pair of the refusal named inside the failure (a gated drag point).
    OfInnerCode,
    /// The pair of the last report of the run.
    LastReport,
}

impl DispositionRule {
    /// Whether a retry is safe when nothing was sent.
    #[must_use]
    pub const fn retryable(self) -> bool {
        match self {
            Self::Fixed(disposition)
            | Self::BySent {
                nothing: disposition,
                ..
            } => {
                matches!(disposition.retry(), Retry::Safe)
            }
            Self::OfInnerCode | Self::LastReport => false,
        }
    }
}

/// Whether the OS saw nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NothingSent {
    Yes,
    No,
    /// Decided by how much went out (a mid-send cancel, an interrupted run).
    Depends,
}

/// What the model does before a retry; present only when retry is safe or after the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recovery {
    RefreshSnapshotThenRetry,
    InspectStateThenRetry,
    AskUser,
}

/// What the model calls next after this failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NextCall {
    /// The call to make next (an example string; the real one names the exact handle).
    Call(&'static str),
    /// Nothing to call: allowed only where the design says nothing follows; `cite` names the
    /// design file and section that says so.
    Nothing { cite: &'static str },
}

/// One row of the table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ErrorRow {
    pub key: FailureKey,
    pub computer: ComputerCode,
    pub disposition: DispositionRule,
    pub nothing_sent: NothingSent,
    pub retryable: bool,
    pub recovery: Option<Recovery>,
    pub next_call: NextCall,
}

/// A failure the table has no row for: a typed result, never a fallthrough code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UnknownFailure {
    /// A numeric code outside the closed engine table.
    Code(i64),
    /// A reason token outside the closed vocabulary.
    Reason { source: Source, token: String },
    /// A known code and a known reason that no stage emits together.
    Pair(FailureKey),
}

impl fmt::Display for UnknownFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "no COMPUTER_* row for {self:?}")
    }
}

impl std::error::Error for UnknownFailure {}

/// The row of `key`.
///
/// # Errors
/// `UnknownFailure::Pair` when no row carries `key`.
pub fn lookup(key: FailureKey) -> Result<&'static ErrorRow, UnknownFailure> {
    rows()
        .find(|row| row.key == key)
        .ok_or(UnknownFailure::Pair(key))
}

/// The row of an engine error as the wire carries it: the number and `data.reason`.
///
/// # Errors
/// `UnknownFailure` for a number outside the closed table, a token outside the
/// vocabulary, or a pair no stage emits.
pub fn from_wire(number: i64, reason: Option<&str>) -> Result<&'static ErrorRow, UnknownFailure> {
    let code = EngineCode::from_number(number).ok_or(UnknownFailure::Code(number))?;
    keyed(Source::Engine(code), reason)
}

fn keyed(source: Source, reason: Option<&str>) -> Result<&'static ErrorRow, UnknownFailure> {
    let reason = match reason {
        None => None,
        Some(token) => Some(
            Reason::from_wire(token).ok_or_else(|| UnknownFailure::Reason {
                source,
                token: token.to_owned(),
            })?,
        ),
    };
    lookup(FailureKey { source, reason })
}
