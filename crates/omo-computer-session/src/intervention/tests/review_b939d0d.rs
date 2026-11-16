//! The review of #13355 at b939d0d2de: the takeover hold is checked again right before delivery,
//! after every wait (M2); a lease end leaves a hold that already lapsed idle, so the next exec
//! acquires it again (L4); a null-mode call never waits on a busy target (L5); a foreign input at
//! the same millisecond as the pre-send check holds the send (L6).

use super::*;

/// M2 (IS-2): the user starts working in the frontmost target during the busy wait; the send
/// waits that out instead of landing on them.
#[test]
fn m2_the_takeover_hold_is_checked_again_after_the_busy_wait_before_delivery() {
    let (backend, sink) = fake(
        r#","busy_timeline":[{"t_ms":0,"window":"101","busy":true,"indicator":"spinner"},{"t_ms":300,"window":"101","busy":false}],"user_input_timeline":[{"t_ms":100,"pid":4242,"kind":"key"}]"#,
    );
    let clock = backend.clock();
    let reply = object_session(Box::new(backend)).framed_click(None).expect("sent once the user paused");
    let paused = report(reply).paused().to_vec();
    assert!(paused.iter().any(|p| p.reason == PauseReason::UserActive), "the send waited for the user: {paused:?}");
    assert!(clock.now_ms() >= 1_000, "not delivered while the user was active: {}", clock.now_ms());
    assert_eq!(sink.len(), 3, "{:?}", sink.lines());
}

/// L4: a hold that lapsed before the lease end is idle there, not parked `released`.
#[test]
fn l4_a_lease_end_leaves_a_lapsed_hold_idle_and_the_next_exec_acquires_it() {
    let (backend, _sink) = fake("");
    let clock = backend.clock();
    let mut session = object_session(Box::new(backend));
    assert!(session.framed_click(None).is_ok(), "the first click delivered");
    assert!(session.display_awake.get().holds_display_awake());
    clock.advance(crate::intervention::DEFAULT_DISPLAY_AWAKE_SESSION_CAP_MS / 2);
    session.control_grant(params(json!({ "reason": "test" })));
    session.control_release();
    assert_eq!(session.display_awake.get(), crate::intervention::DisplayAwakeHold::Idle, "the hold had lapsed before the lease ended");
    assert!(session.framed_click(None).is_ok(), "the second click delivered");
    assert!(session.display_awake.get().holds_display_awake(), "{:?}", session.display_awake.get());
}

/// L5 (plan:382): a null-mode call behaves as v1 - it neither waits on nor refuses a busy target.
#[test]
fn l5_a_null_mode_call_never_waits_on_a_busy_target() {
    let (backend, sink) = fake(r#","busy_timeline":[{"t_ms":0,"window":"101","busy":true,"indicator":"spinner"}]"#);
    let clock = backend.clock();
    let mut session = Session::new(Box::new(backend));
    session.open(params(json!({}))).expect("open");
    session.stop_path_start(params(json!({})));
    assert_eq!(session.framed_click(None), Ok(ExecReply(None)));
    assert_eq!(clock.now_ms(), 0, "no wait in a null-mode session");
    assert_eq!(sink.len(), 3, "{:?}", sink.lines());
}

/// L6: a foreign input stamped at the very millisecond of the pre-send check holds the send.
#[test]
fn l6_a_foreign_input_at_the_same_millisecond_as_the_check_holds_the_send() {
    let (backend, _sink) = fake(r#","user_input_timeline":[{"t_ms":500,"pid":4242,"kind":"key"}]"#);
    backend.clock().advance(500);
    assert!(
        crate::intervention::foreign_input_holds(&backend, Some(4242)),
        "an input at the check's own millisecond is before the send, not after it"
    );
}
