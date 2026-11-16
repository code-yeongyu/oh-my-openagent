//! Per-session permits (read 4 / exec 1) and the per-hand frame budget ladder.

mod ladder;
mod permits;

#[cfg(test)]
mod tests;

pub use ladder::{encoding_for, Encoding, FrameBudget, BUDGET_BUSY, FRAMES_PER_SECOND};
pub use permits::{Permit, PermitKind, Permits, EXEC_PERMITS, READ_PERMITS};
