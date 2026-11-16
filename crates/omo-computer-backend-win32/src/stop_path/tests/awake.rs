//! The Windows display-awake mechanism follows row 22's ONE DisplayAwakeHold state machine (the
//! session's `holds_display_awake()`): it holds a PowerRequestDisplayRequired exactly while the
//! hold says so and never decides on its own.

use crate::overlay::{sync, AwakeAction};

#[test]
fn power_request_follows_the_session_hold() {
    assert_eq!(sync(true, false), AwakeAction::Acquire);
    assert_eq!(sync(true, true), AwakeAction::Keep);
    assert_eq!(sync(false, true), AwakeAction::Release);
    assert_eq!(sync(false, false), AwakeAction::Keep);
}
