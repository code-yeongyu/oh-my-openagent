//! The control grant across `Session`s sharing one slot (as the engine's
//! sessions share the process-wide one): refused grants never steal, and
//! `session.close` releases.

use std::sync::Arc;

use senpi_desktop_backend_fake::FakeScenario;
use senpi_desktop_core::error::{CoreResult, ErrorCode};
use senpi_desktop_core::protocol_params::{CaptureParams, ControlGrantParams, PointParams};
use senpi_desktop_core::protocol_results::ControlStateResult;
use senpi_desktop_core::types::{DesktopSessionOptions, PointerOptions};
use senpi_desktop_safety::{FakeClock, StopPathId, StopSource, Supervisor};
use senpi_desktop_session::{BackendSelection, ControlSlot, Op, Response, Session, SessionSafety, SessionTimeouts};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json"
);

fn scenario() -> BackendSelection {
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(FIXTURE).expect("fixture is readable")).expect("fixture is JSON");
    BackendSelection::FakeScenario(Box::new(FakeScenario::from_json(&json.to_string()).expect("parses")))
}

fn live_supervisor() -> Arc<Supervisor> {
    let supervisor = Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))));
    supervisor.set_live(StopPathId::Global, true);
    supervisor
}

fn start_with(slot: &Arc<ControlSlot>, supervisor: &Arc<Supervisor>) -> Session {
    let safety = SessionSafety {
        supervisor: Arc::clone(supervisor),
        audit: Box::new(|_| {}),
        control_slot: Arc::clone(slot),
    };
    Session::start_supervised(scenario(), SessionTimeouts::default(), safety).expect("session starts")
}

fn start(slot: &Arc<ControlSlot>) -> Session {
    start_with(slot, &live_supervisor())
}

fn grant(reason: &str) -> Op {
    Op::ControlGrant(ControlGrantParams {
        reason: reason.to_owned(),
        confirmation_id: "confirm-1".to_owned(),
    })
}

fn foreground_click(frame: &str) -> Op {
    Op::Click(PointParams {
        target: "101".to_owned(),
        x: 10.0,
        y: 10.0,
        frame_id: Some(frame.to_owned()),
        opts: Some(PointerOptions {
            delivery_mode: Some("foreground".to_owned()),
            ..PointerOptions::default()
        }),
    })
}

fn code(result: CoreResult<Response>) -> Option<ErrorCode> {
    result.err().map(|error| error.code)
}

async fn open(session: &Session) {
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
}

async fn capture(session: &Session) -> String {
    let captured = session
        .submit(Op::Capture(CaptureParams {
            target: "101".to_owned(),
            caps: None,
        }))
        .wait()
        .await
        .expect("captures");
    let Response::Capture(capture) = captured else {
        panic!("expected a capture, got {captured:?}")
    };
    capture.frame_id
}

async fn state(session: &Session) -> ControlStateResult {
    match session.submit(Op::ControlState).wait().await {
        Ok(Response::ControlState(state)) => state,
        other => panic!("control.state failed: {other:?}"),
    }
}

#[tokio::test]
async fn a_second_sessions_grant_is_refused_and_close_releases_the_slot() {
    // Given: two sessions share one slot, and session A holds the grant.
    let slot = ControlSlot::new();
    let first = start(&slot);
    open(&first).await;
    let granted = first.submit(grant("first")).wait().await.expect("grants");
    assert!(matches!(
        granted,
        Response::ControlState(ControlStateResult { active: true, .. })
    ));
    // When: session B asks
    let second = start(&slot);
    open(&second).await;
    let refused = second.submit(grant("second")).wait().await;
    // Then: InputBusy, and A keeps its grant
    assert_eq!(code(refused), Some(ErrorCode::InputBusy));
    assert!(state(&first).await.active);
    // When: A closes
    first.close().wait().await.expect("closes");
    // Then: B can be granted, and B's foreground delivery is admitted
    let granted = second.submit(grant("second")).wait().await.expect("grants after close");
    assert!(matches!(
        granted,
        Response::ControlState(ControlStateResult { active: true, .. })
    ));
    let frame = capture(&second).await;
    assert_eq!(second.submit(foreground_click(&frame)).wait().await, Ok(Response::Unit));
    second.close().wait().await.expect("closes");
}

#[tokio::test]
async fn foreground_delivery_needs_the_grant_and_a_suspension_revokes_it() {
    // Given
    let supervisor = live_supervisor();
    let session = start_with(&ControlSlot::new(), &supervisor);
    open(&session).await;
    let frame = capture(&session).await;
    // When: no grant
    let refused = session.submit(foreground_click(&frame)).wait().await;
    // Then
    assert_eq!(code(refused), Some(ErrorCode::ControlRequired));
    // When: granted
    session
        .submit(grant("with the human watching"))
        .wait()
        .await
        .expect("grants");
    assert_eq!(
        session.submit(foreground_click(&frame)).wait().await,
        Ok(Response::Unit)
    );
    // When: the user stops and then resumes
    supervisor.trigger_stop(StopSource::Hotkey);
    supervisor.reset_for_test();
    supervisor.set_live(StopPathId::Global, true);
    // Then: the grant did not survive the stop
    assert!(!state(&session).await.active);
    assert_eq!(
        code(session.submit(foreground_click(&frame)).wait().await),
        Some(ErrorCode::ControlRequired)
    );
    session.close().wait().await.expect("closes");
}
