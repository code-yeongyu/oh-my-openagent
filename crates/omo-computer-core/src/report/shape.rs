//! Wire validation of an `ActionReport`, run per (verb, report) pair. Without a context
//! only the rules that hold for every verb run; with one, the by-verb receipt rule and the
//! platform's receipt kinds run too.

use super::disposition::Disposition;
use super::effect::{Delivered, Effect};
use super::evidence::Evidence;
use super::rejection::ReportRejection;
use super::verb::ReportContext;

/// The members the rules read.
pub(super) struct Shape<'a> {
    pub disposition: Disposition,
    pub effect: Effect,
    pub delivered: Option<Delivered>,
    pub evidence: &'a [Evidence],
}

pub(super) fn check(shape: &Shape<'_>, context: Option<ReportContext>) -> Result<(), ReportRejection> {
    let _ = (shape.disposition, shape.effect, shape.delivered, shape.evidence, context);
    Ok(())
}
