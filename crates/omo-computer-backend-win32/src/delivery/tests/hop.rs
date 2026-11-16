//! The consumed hop: pending until the target thread dequeues, at once for an unpaintable target,
//! bounded by the hang guard; and its one evidence kind is the core's wire name.

use omo_computer_core::report::EvidenceKind;

use crate::barrier::{consumed_hop, evidence, Barrier, HANG_GUARD};

use super::kit::{win, ScriptedOs};

#[test]
fn the_hop_reads_consumed_once_the_region_clears() {
    let mut os = ScriptedOs::with(vec![(7, win("Edit"))]);
    os.pending_reads = 3;
    assert_eq!(consumed_hop(&mut os, 7), Barrier::Consumed);
    assert_eq!(os.invalidated, [7]);
    assert!(os.waited < HANG_GUARD);
}

#[test]
fn an_unpaintable_target_answers_at_once_and_a_stuck_one_at_the_guard() {
    let mut hidden = ScriptedOs::with(vec![(7, win("Edit"))]);
    hidden.paintable = false;
    assert_eq!(consumed_hop(&mut hidden, 7), Barrier::Unpaintable);
    assert!(hidden.invalidated.is_empty() && hidden.waited.is_zero());
    let mut stuck = ScriptedOs::with(vec![(7, win("Edit"))]);
    stuck.pending_reads = u32::MAX;
    assert_eq!(consumed_hop(&mut stuck, 7), Barrier::HangGuard);
    assert!(stuck.waited >= HANG_GUARD);
}

#[test]
fn the_evidence_kind_is_the_core_wire_name() {
    let kind = evidence(Barrier::Consumed).map(|entry| entry.kind);
    let wire = serde_json::to_value(EvidenceKind::BarrierConsumed).ok();
    assert_eq!(kind.map(serde_json::Value::from), wire);
    assert_eq!(evidence(Barrier::Unpaintable), None);
    assert_eq!(evidence(Barrier::HangGuard), None);
}
