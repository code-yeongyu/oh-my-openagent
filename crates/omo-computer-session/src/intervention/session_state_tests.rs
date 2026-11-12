//! The session-state policy on the fake: a lock refuses exec and pauses, display sleep only
//! reports (and refuses the foreground route), a deactivated session keeps the background
//! route, and an `"unknown"` state refuses and pauses nothing.

use omo_computer_core::intervention::{Pause, PauseReason};
use omo_computer_core::session_state::Tristate;

use super::tests::{fake, object_session, report, wire, FramedClick};

#[test]
fn screen_locked_refuses_exec_and_pauses() {
    let (backend, sink) = fake(r#","session_timeline":[{"t_ms":0,"screen_locked":true}]"#);
    let refused = object_session(Box::new(backend))
        .framed_click(None)
        .expect_err("locked past the ceiling");
    assert_eq!(wire(&refused), ("ScreenLocked", Some("screen_locked")));
    assert_eq!(
        refused.stamps.paused,
        vec![Pause {
            reason: PauseReason::ScreenLocked,
            ms: 120_001
        }]
    );
    let session = refused.stamps.session.clone().expect("object mode stamps the session");
    assert_eq!(session.screen_locked, Tristate::Known(true));
    assert!(sink.is_empty(), "{:?}", sink.lines());

    let (backend, sink) = fake(
        r#","session_timeline":[{"t_ms":0,"screen_locked":true},{"t_ms":5000,"screen_locked":false}]"#,
    );
    let reply = object_session(Box::new(backend))
        .framed_click(None)
        .expect("sent after the unlock");
    assert_eq!(
        report(reply).paused(),
        &[Pause {
            reason: PauseReason::ScreenLocked,
            ms: 5_000
        }]
    );
    assert_eq!(sink.len(), 3);
}

#[test]
fn display_asleep_reports_only() {
    let (backend, sink) = fake(r#","session_timeline":[{"t_ms":0,"display_asleep":true}]"#);
    let mut session = object_session(Box::new(backend));
    let reply = session.framed_click(None).expect("background delivers");
    let report = report(reply);
    assert!(report.paused().is_empty());
    assert_eq!(
        report.session().map(|s| s.display_asleep),
        Some(Tristate::Known(true))
    );
    assert_eq!(sink.len(), 3);
    let refused = session
        .framed_click(Some("foreground"))
        .expect_err("the foreground route needs an awake display");
    assert_eq!(wire(&refused), ("ControlRequired", Some("display_asleep")));
    assert_eq!(sink.len(), 3, "nothing more sent");
}

#[test]
fn deactivated_session_keeps_background_route() {
    let (backend, sink) = fake(r#","session_timeline":[{"t_ms":0,"session_active":false}]"#);
    let mut session = object_session(Box::new(backend));
    let reply = session.framed_click(None).expect("background delivers");
    assert_eq!(
        report(reply).session().map(|s| s.session_active),
        Some(Tristate::Known(false))
    );
    assert_eq!(sink.len(), 3);
    let refused = session
        .framed_click(Some("foreground"))
        .expect_err("the foreground route needs the console");
    assert_eq!(
        wire(&refused),
        ("SessionInactive", Some("session_deactivated"))
    );
    assert_eq!(sink.len(), 3);
}

#[test]
fn a_lock_beside_a_deactivation_governs() {
    let (backend, sink) = fake(
        r#","session_timeline":[{"t_ms":0,"screen_locked":true,"session_active":false}]"#,
    );
    let refused = object_session(Box::new(backend))
        .framed_click(None)
        .expect_err("locked");
    assert_eq!(wire(&refused), ("ScreenLocked", Some("screen_locked")));
    assert!(sink.is_empty());
}

#[test]
fn a_system_suspend_pauses_and_ends_typed_past_the_ceiling() {
    let (backend, sink) = fake(r#","session_timeline":[{"t_ms":0,"system_suspended":true}]"#);
    let refused = object_session(Box::new(backend))
        .framed_click(None)
        .expect_err("suspended past the ceiling");
    assert_eq!(wire(&refused), ("SessionInactive", Some("system_suspended")));
    assert_eq!(
        refused.stamps.paused.first().map(|p| p.reason),
        Some(PauseReason::SystemSuspended)
    );
    assert!(sink.is_empty());
}

#[test]
fn an_all_unknown_session_refuses_and_pauses_nothing() {
    let (backend, sink) = fake("");
    let mut session = object_session(Box::new(backend));
    let reply = session.framed_click(Some("foreground")).expect("delivered");
    let report = report(reply);
    assert!(report.paused().is_empty());
    assert_eq!(
        report.session().map(|s| s.screen_locked),
        Some(Tristate::Unknown(omo_computer_core::session_state::UnknownLiteral::Unknown))
    );
    // Row 21 (R26): a foreground delivery also shows the presence surface; the click itself
    // is still exactly three input lines.
    let lines = sink.lines();
    assert_eq!(lines.iter().filter(|line| line.starts_with("post_input")).count(), 3, "{lines:?}");
    assert!(lines.iter().any(|line| line == "presence show"), "{lines:?}");
}
