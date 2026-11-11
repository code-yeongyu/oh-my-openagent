//! The by-verb effect rule: which `effect` a completed send reads, given its evidence.
//! It never yields `no_change` (a read-back equal to its baseline is `observed`), and it
//! yields `suspected_noop` only for a quiet settle window with nothing read.

use super::effect::Effect;
use super::evidence::{Evidence, EvidenceClass};
use super::verb::ReportContext;

/// What the settle window saw on a send whose effect is still open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Settle {
    /// No settle window ran (a populated tree), or it saw a change.
    NotQuiet,
    /// A childless hit in a suspect viewport, no ambient redraw, and no change anywhere.
    QuietSuspect,
}

/// The effect of a send that was delivered exactly once and completed.
#[must_use]
pub fn completed_effect(context: ReportContext, evidence: &[Evidence], settle: Settle) -> Effect {
    let confirming = evidence
        .iter()
        .any(|entry| entry.is_receipt() && entry.kind() == context.verb.confirming_kind());
    let read_target = evidence
        .iter()
        .any(|entry| entry.class() == EvidenceClass::Observation && entry.kind().reads_target());
    let observed_anything = evidence
        .iter()
        .any(|entry| entry.class() == EvidenceClass::Observation);
    if confirming {
        Effect::Confirmed
    } else if read_target {
        Effect::Observed
    } else if settle == Settle::QuietSuspect && !observed_anything {
        Effect::SuspectedNoop
    } else {
        Effect::Unverifiable
    }
}
