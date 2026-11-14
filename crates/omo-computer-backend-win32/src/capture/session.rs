//! The session state capture reads through a seam (plan row 55; d-windows.md:383): a null or
//! near-black frame while `session.sessionActive` is false or `session.displayAsleep` is true
//! answers `CaptureFailed{null_frame|black_frame}` with the session as its cause. Row 55 has no
//! OS source of its own (ruling R70d(2)): the one source of session state is the backend's
//! `InterventionSource::session_state()` (row 22's trait, not in row 55's base) fed by the Windows
//! `SessionState` probes of design row N18 (plan row 60), so the real OS reads `unknown` until
//! row 60 feeds this seam, and under `unknown` nothing fires (a dark desktop stays a frame). The
//! reply half - the `session` stamp on the error and `nextCall:"ask_user"` - is owed to row 60.

use omo_computer_core::session_state::{Tristate, UnknownLiteral};

/// The two session facts the capture ladder reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionCondition {
    pub session_active: Tristate,
    pub display_asleep: Tristate,
}

impl SessionCondition {
    /// No OS answer for either fact: the session cause never fires.
    pub const UNKNOWN: Self = Self {
        session_active: Tristate::Unknown(UnknownLiteral::Unknown),
        display_asleep: Tristate::Unknown(UnknownLiteral::Unknown),
    };

    /// The session cause: the session is known inactive or the display is known asleep.
    #[must_use]
    pub const fn is_dark(&self) -> bool {
        matches!(self.session_active, Tristate::Known(false))
            || matches!(self.display_asleep, Tristate::Known(true))
    }
}

impl Default for SessionCondition {
    fn default() -> Self {
        Self::UNKNOWN
    }
}
