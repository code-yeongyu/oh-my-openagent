use std::sync::Arc;
use std::time::{Duration, Instant};

use senpi_desktop_backend_fake::FakeMethod;
use senpi_desktop_core::error::{CoreResult, ErrorCode};
use senpi_desktop_core::protocol_params::{CaptureParams, TypeTextParams};
use senpi_desktop_core::types::{DesktopSessionOptions, DisplaySelector, ScreenState};
use senpi_desktop_safety::{Clock, FakeClock, StopPathId, StopSource, Supervisor};
use serde_json::json;

use super::{DisplayAwake, GRACE};
use crate::request::{Op, Response};
use crate::screen_notes::op_display;
use crate::test_support::{harness, session_factory, AwakeHolds, FakeScreen, Harness};
use crate::{Session, SessionSafety, SessionTimeouts};

fn capture(target: &str) -> Op {
    Op::Capture(CaptureParams {
        target: target.to_owned(),
        caps: None,
        exclude_window_titles: None,
    })
}

fn type_into(target: &str) -> Op {
    Op::TypeText(TypeTextParams {
        target: target.to_owned(),
        text: "a".to_owned(),
        opts: None,
    })
}

fn serve(harness: &mut Harness, op: Op) -> CoreResult<Response> {
    let mut reply = None;
    harness.worker.dispatch(op, &|| false, |result| {
        reply = Some(result);
        true
    });
    reply.expect("dispatch replies")
}

#[test]
fn the_hold_lapses_sixty_seconds_after_the_last_request_finished() {
    // Given two requests, the second finishing 30 s after the first.
    let (awake, holds, start) = (
        DisplayAwake::default(),
        AwakeHolds::default(),
        Instant::now(),
    );
    awake.begin(|| Some(holds.hold()));
    awake.finish(start);
    awake.begin(|| Some(holds.hold()));
    let last = start + Duration::from_secs(30);
    awake.finish(last);
    // When the fake clock reaches one second short of the grace, then the grace.
    awake.expire(last + GRACE - Duration::from_secs(1));
    let held_before = holds.held();
    awake.expire(last + GRACE);
    // Then one assertion covered both requests and lapsed exactly at the grace.
    assert_eq!(GRACE, Duration::from_secs(60));
    assert!(held_before);
    assert_eq!(
        (holds.taken(), holds.released(), awake.deadline()),
        (1, 1, None)
    );
}

#[test]
fn a_running_request_never_lapses_and_a_refused_assertion_sets_no_deadline() {
    let (awake, holds, start) = (
        DisplayAwake::default(),
        AwakeHolds::default(),
        Instant::now(),
    );
    awake.begin(|| Some(holds.hold()));
    awake.expire(start + Duration::from_secs(3600));
    assert!(holds.held());
    let refused = DisplayAwake::default();
    refused.begin(|| None);
    refused.finish(start);
    assert_eq!(refused.deadline(), None);
}

#[test]
fn a_stop_releases_at_once_and_the_next_request_takes_a_new_hold() {
    let (awake, holds) = (DisplayAwake::default(), AwakeHolds::default());
    awake.begin(|| Some(holds.hold()));
    awake.finish(Instant::now());
    awake.release();
    assert_eq!((holds.released(), awake.deadline()), (1, None));
    awake.begin(|| Some(holds.hold()));
    assert_eq!((holds.taken(), holds.held()), (2, true));
}

#[test]
fn closing_releases_for_good() {
    let (awake, holds) = (DisplayAwake::default(), AwakeHolds::default());
    awake.begin(|| Some(holds.hold()));
    awake.close();
    awake.begin(|| Some(holds.hold()));
    assert_eq!((holds.taken(), holds.released()), (1, 1));
}

#[test]
fn capture_and_exec_take_the_hold_but_control_state_does_not() {
    let mut harness = harness(&json!({}));
    serve(&mut harness, Op::ControlState).expect("reads control state");
    assert_eq!(harness.awake.taken(), 0);
    serve(&mut harness, capture("101")).expect("captures");
    assert_eq!((harness.awake.taken(), harness.awake.held()), (1, true));
    harness.worker.awake.release();
    serve(&mut harness, type_into("101")).expect("types");
    assert_eq!((harness.awake.taken(), harness.awake.held()), (2, true));
    assert!(harness.worker.awake.deadline().is_some());
}

#[test]
fn a_failure_names_the_lock_and_requests_name_the_display_they_aim_at() {
    let mut harness = harness(&json!({}));
    harness.screen.set(ScreenState {
        locked: true,
        display_asleep: false,
    });
    harness
        .faults
        .fail_next(FakeMethod::Capture, ErrorCode::CaptureFailed);
    let error = serve(&mut harness, capture("101")).expect_err("capture fails");
    assert!(
        error.message.ends_with(" (the screen is locked)"),
        "{}",
        error.message
    );
    assert_eq!(harness.screen.asked(), [None]);
    assert_eq!(
        op_display(&capture("display:2")),
        Some(DisplaySelector::Id("2".to_owned()))
    );
    assert_eq!(op_display(&type_into("101")), None);
}

fn session(awake: &AwakeHolds, screen: &FakeScreen) -> (Session, Arc<Supervisor>) {
    let supervisor = Arc::new(Supervisor::new(
        Arc::new(FakeClock::new(0)) as Arc<dyn Clock>
    ));
    supervisor.set_live(StopPathId::Global, true);
    let safety = SessionSafety {
        supervisor: Arc::clone(&supervisor),
        audit: Box::new(|_| {}),
        control_slot: crate::grant::ControlSlot::new(),
    };
    let session = Session::start_supervised(
        session_factory(awake, screen),
        SessionTimeouts::default(),
        safety,
    )
    .expect("session starts");
    (session, supervisor)
}

async fn open_and_capture(session: &Session) {
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    session
        .submit(capture("101"))
        .wait()
        .await
        .expect("captures");
}

#[tokio::test]
async fn capabilities_take_no_hold_and_read_display_sleep_live() {
    let (awake, screen) = (AwakeHolds::default(), FakeScreen::default());
    let (session, _supervisor) = session(&awake, &screen);
    screen.set(ScreenState {
        locked: false,
        display_asleep: true,
    });
    assert!(session.capabilities().display_asleep);
    assert_eq!(awake.taken(), 0);
    session.close().wait().await.expect("closes");
}

#[tokio::test]
async fn session_close_releases_the_hold_for_good() {
    let (awake, screen) = (AwakeHolds::default(), FakeScreen::default());
    let (session, _supervisor) = session(&awake, &screen);
    open_and_capture(&session).await;
    assert!(awake.held());
    session.close().wait().await.expect("closes");
    assert_eq!((awake.taken(), awake.held()), (1, false));
}

#[tokio::test]
async fn a_disconnect_releases_the_hold() {
    let (awake, screen) = (AwakeHolds::default(), FakeScreen::default());
    let (session, _supervisor) = session(&awake, &screen);
    open_and_capture(&session).await;
    drop(session);
    assert_eq!((awake.taken(), awake.held()), (1, false));
}

#[tokio::test]
async fn a_committed_stop_releases_the_hold() {
    let (awake, screen) = (AwakeHolds::default(), FakeScreen::default());
    let (session, supervisor) = session(&awake, &screen);
    open_and_capture(&session).await;
    supervisor.trigger_stop(StopSource::HostRelay);
    assert_eq!((awake.taken(), awake.held()), (1, false));
    session.close().wait().await.expect("closes");
}
