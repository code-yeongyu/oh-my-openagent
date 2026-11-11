//! Every refusal the fake answers with is a closed `EngineCode` plus a reason token of the
//! `COMPUTER_*` table. `Refusal.reason` is a non-optional token in the core type, but the
//! table keys most codes by their bare row (no `data.reason`), which the v1 corpus carries on
//! the wire. The fake marks a bare refusal with [`BARE_REASON`], and [`refusal_row`] resolves
//! both kinds through the one table.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{self, EngineCode, ErrorRow, FailureKey, Source, UnknownFailure};

/// The reason of a refusal keyed by its code's bare row. Owed to the core refusal type: an
/// absent reason is not expressible there yet.
pub const BARE_REASON: &str = "";

/// A refusal keyed by `code`'s bare row.
#[must_use]
pub const fn bare(code: EngineCode) -> Refusal {
    Refusal::new(code, BARE_REASON)
}

/// The table row of a refusal the fake produced, bare or with a reason.
///
/// # Errors
/// `UnknownFailure` when the pair has no row.
pub fn refusal_row(refusal: &Refusal) -> Result<&'static ErrorRow, UnknownFailure> {
    if refusal.reason == BARE_REASON {
        error::lookup(FailureKey {
            source: Source::Engine(refusal.code),
            reason: None,
        })
    } else {
        refusal.row()
    }
}
