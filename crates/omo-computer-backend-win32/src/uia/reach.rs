//! What the UIA verbs keep when the release helper cannot run (row 56's `enclosing_job_no_breakaway`):
//! a held key could outlive the engine, so the keyboard and pointer routes close, but the UIA
//! action verbs hold nothing and stay, and background reach reads `ax_only`.

use omo_computer_core::capabilities::{BackgroundReach, InputMode, ReleaseHelperReason};

/// The input modes and background reach the capabilities report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AxReach {
    pub input_modes: Vec<InputMode>,
    pub background_reach: BackgroundReach,
}

/// The reach with the release helper's state `helper_unavailable` (`None`: the helper runs).
#[must_use]
pub fn ax_reach(helper_unavailable: Option<ReleaseHelperReason>) -> AxReach {
    match helper_unavailable {
        Some(_) => AxReach {
            input_modes: vec![InputMode::Ax],
            background_reach: BackgroundReach::AxOnly,
        },
        None => AxReach {
            input_modes: vec![InputMode::Pointer, InputMode::Keyboard, InputMode::Ax],
            background_reach: BackgroundReach::Win32ClassicOnly,
        },
    }
}
