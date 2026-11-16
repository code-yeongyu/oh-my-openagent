//! The Windows route ladder (d-windows.md '## Background delivery limits', the ROUTE stage): a UIA
//! pattern if safe, else a classic control message, else a post on a family the drop matrix admits,
//! else `invoke_at_point` for a plain left click on a non-Chromium window (Chromium's `Invoke`
//! reports success without acting), else the foreground lease when the grant allows it - exactly
//! ONE route per call, never a silent fallback. `routeLadder` is read from the same ladder.

use omo_computer_core::capabilities::RouteRung;

use crate::delivery::family::{admit, Family, Verb};

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
    if call.pattern_safe {
        Rung::UiaPattern
    } else if call.classic_message {
        Rung::ClassicMessage
    } else if admit(call.family, call.verb).is_ok() {
        Rung::Posted
    } else if call.verb == Verb::LeftClick && call.family != Family::Chromium {
        Rung::InvokeAtPoint
    } else if call.foreground_granted {
        Rung::Foreground
    } else {
        Rung::Refused
    }
}

/// `capabilities().routeLadder` for a window of `family`: `["semantic","physical"]` when a plain
/// left click there takes `invoke_at_point` before the physical leg, `["physical"]` otherwise.
#[must_use]
pub fn route_ladder(family: Family) -> Vec<RouteRung> {
    let click = Call {
        family,
        verb: Verb::LeftClick,
        pattern_safe: false,
        classic_message: false,
        foreground_granted: false,
    };
    if ladder(click) == Rung::InvokeAtPoint {
        vec![RouteRung::Semantic, RouteRung::Physical]
    } else {
        vec![RouteRung::Physical]
    }
}
