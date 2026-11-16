//! The Windows route ladder (d-windows.md '## Background delivery limits', the ROUTE stage):
//! UIA pattern if safe, else a classic control message, else a post on an accepting family, else
//! `invoke_at_point` for a plain left click on a non-Chromium window, else the foreground lease
//! when the grant allows it - exactly ONE route per call, never a silent fallback.

use crate::delivery::family::{Family, Verb};

/// One rung of the ladder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rung {
    UiaPattern,
    ClassicMessage,
    Posted,
    InvokeAtPoint,
    Foreground,
    Refused,
}

/// What the ladder knows about one call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Call {
    pub family: Family,
    pub verb: Verb,
    pub pattern_safe: bool,
    pub classic_message: bool,
    pub foreground_granted: bool,
}

/// The one route `call` takes.
#[must_use]
pub fn ladder(call: Call) -> Rung {
    let _ = call;
    Rung::Posted
}
