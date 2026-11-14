//! AC-98: for every adjacent pair of gates with both conditions set, the earlier gate's code
//! wins; a read under the lock, the sleep, the inactive session and a composer is admitted.

use omo_computer_core::backend::Refusal;
use omo_computer_core::results::PermissionState;
use omo_computer_core::session_state::Tristate;

use super::super::verdicts::{
    ConsentRefusal, ConsequentialRefusal, FrameRefusal, LeaseRefusal, RouteRefusal,
};
use super::super::{gate, Gate, GateFacts, PointTarget, Tier, VerbKind};
use super::{deaf, exec, plain, self_set, tables, terminal};
use crate::latch::SuspendReason;

/// Sets the condition that makes `gate` fire.
fn set(gate: Gate, facts: &mut GateFacts, targets: &mut Vec<PointTarget>) {
    match gate {
        Gate::Latch => facts.latch = Some(SuspendReason::StopMarker),
        Gate::StopPath => facts.stop_path = deaf(),
        Gate::Lock => facts.screen_locked = Tristate::Known(true),
        Gate::Target => *targets = terminal(),
        Gate::OsPermission => facts.permission = PermissionState::Denied,
        Gate::Consent => facts.consent = Some(ConsentRefusal::DeniedThisTurn),
        Gate::Route => facts.route = Some(RouteRefusal::SessionDeactivated),
        Gate::Lease => facts.lease = Some(LeaseRefusal::Window),
        Gate::Consequential => facts.consequential = Some(ConsequentialRefusal::SendOnEnter),
        Gate::Frame => facts.frame = Some(FrameRefusal::Superseded),
        Gate::Takeover => facts.user_active_in_target = true,
    }
}

fn run(gates: &[Gate]) -> (Gate, Refusal) {
    let set_ = self_set();
    let mut facts = exec(VerbKind::Pointer);
    let mut targets = plain();
    for gate in gates {
        set(*gate, &mut facts, &mut targets);
    }
    let refused = gate(&facts, &tables(&set_), || targets).expect_err("a gate fires");
    assert!(
        refused.next_call().is_ok(),
        "{:?} has a row",
        refused.refusal
    );
    (refused.gate, refused.refusal)
}

type Wire = (&'static str, Option<&'static str>);

fn wire(refusal: &Refusal) -> Wire {
    (refusal.code.wire(), refusal.reason)
}

#[test]
fn refusal_order_adjacent_pairs() {
    for pair in Gate::ORDER.windows(2) {
        let (earlier, later) = (pair[0], pair[1]);
        let (alone, refusal_alone) = run(&[earlier]);
        assert_eq!(alone, earlier, "{earlier:?} alone");
        assert_eq!(run(&[later]).0, later, "{later:?} alone");
        let (fired, refusal) = run(&[later, earlier]);
        assert_eq!(
            (fired, &refusal),
            (earlier, &refusal_alone),
            "{earlier:?} + {later:?}"
        );
    }
    // The contract's own list, in its words.
    let cases: [(&[Gate], Wire); 9] = [
        (
            &[Gate::Latch, Gate::Lock],
            ("Suspended", Some("stop_marker")),
        ),
        (
            &[Gate::Lock, Gate::Target],
            ("ScreenLocked", Some("screen_locked")),
        ),
        (
            &[Gate::Target, Gate::OsPermission],
            ("ProtectedProcess", Some("self_target")),
        ),
        (
            &[Gate::OsPermission, Gate::Consent],
            ("PermissionDenied", None),
        ),
        (
            &[Gate::Consent, Gate::Route],
            ("ControlRequired", Some("denied_this_turn")),
        ),
        (
            &[Gate::Route, Gate::Lease],
            ("SessionInactive", Some("session_deactivated")),
        ),
        (
            &[Gate::Lease, Gate::Consequential],
            ("InputBusy", Some("window")),
        ),
        (
            &[Gate::Consequential, Gate::Frame],
            ("ConsequentialAction", Some("send_on_enter")),
        ),
        (
            &[Gate::Frame, Gate::Takeover],
            ("InvalidCoordinateFrame", Some("superseded")),
        ),
    ];
    for (gates, expected) in cases {
        assert_eq!(wire(&run(gates).1), expected, "{gates:?}");
    }
    // Every condition at once still reads gate 1.
    assert_eq!(run(&Gate::ORDER).0, Gate::Latch);
}

#[test]
fn a_read_runs_only_the_latch_permission_and_consent_gates() {
    let set_ = self_set();
    let mut facts = GateFacts::clear(Tier::Read, VerbKind::Pointer, deaf());
    facts.screen_locked = Tristate::Known(true);
    facts.route = Some(RouteRefusal::DisplayAsleep);
    facts.lease = Some(LeaseRefusal::Window);
    facts.consequential = Some(ConsequentialRefusal::SendOnEnter);
    facts.frame = Some(FrameRefusal::Superseded);
    let admitted = gate(&facts, &tables(&set_), plain).expect("a read is admitted");
    assert_eq!(admitted.stop_path, None);
    facts.route = Some(RouteRefusal::SessionDeactivated);
    assert!(
        gate(&facts, &tables(&set_), plain).is_ok(),
        "an inactive session never refuses a read"
    );
    facts.consent = Some(ConsentRefusal::ConsentOff);
    assert_eq!(
        gate(&facts, &tables(&set_), plain)
            .expect_err("consent")
            .gate,
        Gate::Consent
    );
    facts.permission = PermissionState::Denied;
    assert_eq!(
        gate(&facts, &tables(&set_), plain)
            .expect_err("permission")
            .gate,
        Gate::OsPermission
    );
    facts.latch = Some(SuspendReason::Api);
    assert_eq!(
        gate(&facts, &tables(&set_), plain).expect_err("latch").gate,
        Gate::Latch
    );
}

#[test]
fn unknown_lock_never_refuses_and_targets_are_read_only_after_gate_3() {
    let set_ = self_set();
    let facts = exec(VerbKind::Pointer);
    assert!(
        gate(&facts, &tables(&set_), plain).is_ok(),
        "an unknown lock state passes"
    );
    let mut locked = facts;
    locked.screen_locked = Tristate::Known(true);
    let refused = gate(&locked, &tables(&set_), || -> Vec<PointTarget> {
        panic!("the targets are not resolved once gate 3 refused")
    });
    assert_eq!(refused.expect_err("locked").gate, Gate::Lock);
}
