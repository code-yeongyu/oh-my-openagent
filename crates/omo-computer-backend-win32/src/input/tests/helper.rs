//! The release helper's job read-back decides what may hold a key or button (d-windows.md
//! '## Input', RELEASE HELPER; fixture win-helper-in-job-refuses-held-verbs.json).

use omo_computer_core::capabilities::ReleaseHelperReason;
use omo_computer_core::error::{EngineCode, Reason};

use crate::release_helper::{admit, HelperState, VerbKind};

#[test]
fn release_helper_inside_a_job_refuses_every_held_verb() {
    let state = HelperState::from_read_back(Some(true));
    for verb in [VerbKind::Hold, VerbKind::HoldingInput] {
        let refusal = admit(state, verb).expect_err("refused before any OS call");
        assert_eq!(refusal.code, EngineCode::StopPathUnavailable);
        assert_eq!(
            refusal.reason,
            Some(Reason::ReleaseHelperUnavailable.wire())
        );
    }
    assert!(
        admit(state, VerbKind::AxAction).is_ok(),
        "UIA action verbs hold nothing"
    );
    assert!(admit(state, VerbKind::Read).is_ok());
    let capability = state.capability();
    assert!(!capability.available);
    assert_eq!(
        capability.reason,
        Some(ReleaseHelperReason::EnclosingJobNoBreakaway)
    );
    assert!(state.ax_only());
}

#[test]
fn unproven_helper_refuses_holds_alone_and_a_helper_outside_every_job_admits_all() {
    let unproven = HelperState::from_read_back(None);
    assert!(admit(unproven, VerbKind::Hold).is_err());
    assert!(admit(unproven, VerbKind::HoldingInput).is_ok());
    assert!(!unproven.ax_only());
    let out = HelperState::from_read_back(Some(false));
    for verb in [
        VerbKind::Hold,
        VerbKind::HoldingInput,
        VerbKind::AxAction,
        VerbKind::Read,
    ] {
        assert!(admit(out, verb).is_ok());
    }
    assert!(out.capability().available);
}
