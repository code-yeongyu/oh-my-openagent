//! The user's own key presses and clicks, as a backend's watch records them:
//! the platform-neutral feed a session reads to learn that the user stepped
//! into an app it works in.

use std::time::Instant;

/// What the user pressed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserPressKind {
    Key,
    Click,
}

/// One key press or click by the user, or by a tool posting for them (such
/// as dictation), and never one the engine posted itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UserPress {
    /// The process the press landed in.
    pub pid: u32,
    pub kind: UserPressKind,
    /// When the watch saw it.
    pub at: Instant,
}

/// The presses recorded since the last read, oldest first.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UserPresses {
    pub presses: Vec<UserPress>,
    /// Older presses the bounded record let go before anyone read them; a
    /// reader treats a non-zero count as input into an unknown app.
    pub dropped: u64,
}
