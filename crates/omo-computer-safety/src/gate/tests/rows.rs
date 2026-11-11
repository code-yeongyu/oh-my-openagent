//! Every `(code, reason)` pair any gate or stage emits resolves through the one error table
//! to a row that admits a refusal before send, with a next call.

use omo_computer_core::error::{NextCall, NothingSent};

use super::super::verdicts::{
    ConsentRefusal, ConsequentialRefusal, FrameRefusal, LeaseRefusal, LockRefusal,
    PermissionRefusal, RouteRefusal, TakeoverRefusal, TargetRefusal,
};
use super::super::{Gate, GateRefusal};
use crate::latch::SuspendReason;
use crate::stop_path::StopPathFailure;

#[test]
fn every_gate_and_stage_pair_resolves_through_the_table() {
    let mut pairs = 0;
    for gate in Gate::ORDER {
        let refusals = gate.refusals();
        assert!(!refusals.is_empty(), "{gate:?} emits nothing");
        for refusal in refusals {
            let row = refusal.row().unwrap_or_else(|e| panic!("{gate:?}: {e}"));
            assert_ne!(row.nothing_sent, NothingSent::No, "{gate:?} {refusal:?}");
            let refused = GateRefusal::new(gate, refusal);
            assert!(refused.nothing_sent());
            assert!(matches!(
                refused.next_call(),
                Ok(NextCall::Call(_) | NextCall::Nothing { .. })
            ));
            pairs += 1;
        }
    }
    let sizes = [
        SuspendReason::ALL.len(),
        StopPathFailure::ALL.len(),
        LockRefusal::ALL.len(),
        TargetRefusal::ALL.len(),
        PermissionRefusal::ALL.len(),
        ConsentRefusal::ALL.len(),
        RouteRefusal::ALL.len(),
        LeaseRefusal::ALL.len(),
        ConsequentialRefusal::ALL.len(),
        FrameRefusal::ALL.len(),
        TakeoverRefusal::ALL.len(),
    ];
    assert_eq!(
        pairs,
        sizes.iter().sum::<usize>(),
        "each stage set belongs to exactly one gate"
    );
    assert_eq!(
        Gate::ORDER.map(Gate::number),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    );
}

#[test]
fn the_stop_path_reasons_read_as_the_contract_spells_them() {
    let tokens = StopPathFailure::ALL.map(|failure| failure.refusal().reason);
    assert_eq!(
        tokens,
        [
            Some("deaf"),
            Some("host_relay_not_allowed"),
            Some("heartbeat_stale"),
            Some("no_listener")
        ]
    );
}
