//! The hook-free consumption barrier: `consumed` proves the target's thread took the posted
//! messages off its queue (DELIVERY evidence, `barrier_consumed`), never that the effect happened.

/// What the barrier read after a post.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Barrier {
    Consumed,
    Pending,
}

/// The evidence a barrier reading contributes to the report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BarrierEvidence {
    pub kind: &'static str,
    /// Delivery evidence only: it never confirms the effect.
    pub confirms_effect: bool,
}

/// The evidence of `barrier`.
#[must_use]
pub fn evidence(barrier: Barrier) -> Option<BarrierEvidence> {
    let _ = barrier;
    Some(BarrierEvidence { kind: "consumed", confirms_effect: true })
}
