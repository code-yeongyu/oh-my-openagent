//! Row 22 on the fake: the display-awake hold an exec acquires and a lease end releases.

use super::*;

#[test]
fn a_foreground_lease_ending_releases_the_display_awake_hold_and_nothing_reacquires_it() {
    let (backend, _sink) = fake("");
    let mut session = object_session(Box::new(backend));
    assert!(session.framed_click(None).is_ok(), "the click delivered");
    assert!(session.display_awake.get().holds_display_awake(), "an exec acquires the hold");
    // Row 21's foreground lease, then the lease ends under the user.
    session.control_grant(params(json!({ "reason": "test" })));
    session.control_release();
    assert_eq!(
        session.display_awake.get(),
        crate::intervention::DisplayAwakeHold::Released,
        "the lease ending releases the hold"
    );
    assert!(session.framed_click(None).is_ok(), "background click still delivers");
    assert!(
        !session.display_awake.get().holds_display_awake(),
        "nothing re-acquires the hold after the lease ended"
    );
}

#[test]
fn an_exec_after_session_open_acquires_the_display_awake_hold() {
    let (backend, _sink) = fake("");
    let mut session = object_session(Box::new(backend));
    assert_eq!(
        session.display_awake.get(),
        crate::intervention::DisplayAwakeHold::Idle,
        "session.open leaves the hold idle, not parked"
    );
    assert!(session.framed_click(None).is_ok(), "the click delivered");
    assert!(session.display_awake.get().holds_display_awake(), "the exec acquires the hold");
}
