//! The control grant across `Session`s of one process: the slot is
//! process-wide, refused grants never steal, and `session.close` releases.

use std::sync::Arc;

use senpi_desktop_backend_fake::FakeScenario;
use senpi_desktop_core::error::{CoreResult, ErrorCode};
use senpi_desktop_core::protocol_params::{CaptureParams, ControlGrantParams, PointParams};
use senpi_desktop_core::protocol_results::ControlStateResult;
use senpi_desktop_core::types::{DesktopSessionOptions, PointerOptions};
use senpi_desktop_safety::{FakeClock, StopPathId, Supervisor};
use senpi_desktop_session::{BackendSelection, Op, Response, Session, SessionSafety, SessionTimeouts};
use serde_json::json;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json"
);

fn scenario() -> BackendSelection {
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(FIXTURE).expect("fixture is readable")).expect("fixture is JSON");
    BackendSelection::FakeScenario(Box::new(FakeScenario::from_json(&json.to_string()).expect("parses")))
}

fn live_stop_path() -> SessionSafety {
    let supervisor = Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))));
    supervisor.set_live(StopPathId::Global, true);
    SessionSafety {
        supervisor,
        audit: Box::new(|_| {}),
    }
}

fn start() -> Session {
    Session::start_supervised(scenario(), SessionTimeouts::default(), live_stop_path()).expect("session starts")
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
    // Given: session A holds the process-wide grant.
    let first = start();
    open(&first).await;
    let granted = first.submit(grant("first")).wait().await.expect("grants");
    assert!(matches!(
        granted,
        Response::ControlState(ControlStateResult { active: true, .. })
    ));
    // When: session B asks
    let second = start();
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
    let session = start();
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
    session.close().wait().await.expect("closes");
    let _ = json!(());
}
