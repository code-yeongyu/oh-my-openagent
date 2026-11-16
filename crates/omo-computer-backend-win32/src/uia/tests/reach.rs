use omo_computer_core::capabilities::{BackgroundReach, InputMode, ReleaseHelperReason};

use crate::uia::reach::ax_reach;

#[test]
fn action_verbs_stay_available_when_the_release_helper_is_inside_a_job_and_reach_reads_ax_only() {
    let jailed = ax_reach(Some(ReleaseHelperReason::EnclosingJobNoBreakaway));
    assert_eq!(jailed.input_modes, vec![InputMode::Ax], "the AX action verbs stay");
    assert_eq!(jailed.background_reach, BackgroundReach::AxOnly);
    let free = ax_reach(None);
    assert!(free.input_modes.contains(&InputMode::Ax));
    assert!(free.input_modes.contains(&InputMode::Keyboard));
    assert_ne!(free.background_reach, BackgroundReach::AxOnly);
}
