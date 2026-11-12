//! The release helper's state and what it admits (d-windows.md '## Input', RELEASE HELPER). After
//! spawning `omo-computer-engine --release-helper` with breakaway, the engine reads
//! `IsProcessInJob(helper, NULL)` back: TRUE is a measured failure - the helper would die with an
//! enclosing job before it releases anything - so every verb that holds a key or button is
//! refused; before the read-back only the explicit holds are refused.

use omo_computer_core::backend::Refusal;
use omo_computer_core::capabilities::{ReleaseHelper, ReleaseHelperReason};
use omo_computer_core::error::{EngineCode, Reason};

/// What the helper read-back established.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HelperState {
    /// The read-back has not been taken yet.
    Unproven,
    /// The helper runs outside every job.
    Available,
    /// `IsProcessInJob(helper, NULL)` read TRUE.
    Unavailable,
}

/// How a verb uses input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerbKind {
    /// `key.down` / `mouse.down`.
    Hold,
    /// `type`, `press`, `click`, `drag`, `scroll` on an input route: each holds a key or button
    /// for some interval.
    HoldingInput,
    /// UI Automation action verbs and clipboard paste: nothing is held.
    AxAction,
    Read,
}

/// The refusal of a verb that needs the release helper.
pub const RELEASE_HELPER_UNAVAILABLE: Refusal = Refusal::new(
    EngineCode::StopPathUnavailable,
    Reason::ReleaseHelperUnavailable.wire(),
);

impl HelperState {
    /// `None` before the read-back; `Some(in_job)` after it.
    #[must_use]
    pub const fn from_read_back(in_job: Option<bool>) -> Self {
        match in_job {
            None => Self::Unproven,
            Some(false) => Self::Available,
            Some(true) => Self::Unavailable,
        }
    }

    /// `capabilities().releaseHelper`.
    #[must_use]
    pub const fn capability(self) -> ReleaseHelper {
        match self {
            Self::Unavailable => ReleaseHelper {
                available: false,
                reason: Some(ReleaseHelperReason::EnclosingJobNoBreakaway),
            },
            Self::Unproven | Self::Available => ReleaseHelper {
                available: !matches!(self, Self::Unproven),
                reason: None,
            },
        }
    }

    /// `backgroundReach` reads `ax_only` when nothing can release a held input.
    #[must_use]
    pub const fn ax_only(self) -> bool {
        matches!(self, Self::Unavailable)
    }
}

/// Admits `verb` under `state`, before any OS call.
///
/// # Errors
/// [`RELEASE_HELPER_UNAVAILABLE`] with nothing sent.
pub const fn admit(state: HelperState, verb: VerbKind) -> Result<(), Refusal> {
    match (state, verb) {
        (HelperState::Unavailable, VerbKind::Hold | VerbKind::HoldingInput)
        | (HelperState::Unproven, VerbKind::Hold) => Err(RELEASE_HELPER_UNAVAILABLE),
        _ => Ok(()),
    }
}
