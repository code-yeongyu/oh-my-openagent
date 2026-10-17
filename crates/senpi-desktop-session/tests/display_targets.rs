use std::sync::{Arc, Mutex};

use senpi_desktop_backend_fake::{FakeBackend, FakeScenario, RecordedPointer, RecordingSink, SinkOp};
use senpi_desktop_core::backend::{Backend, DeliveryMode};
use senpi_desktop_core::error::{CoreResult, ErrorCode};
use senpi_desktop_core::protocol_params::{CaptureParams, PointParams};
use senpi_desktop_core::types::{CaptureResult, DesktopPoint, DesktopSessionOptions, Target};
use senpi_desktop_safety::{FakeClock, StopPathId, Supervisor};
use senpi_desktop_session::{
    BackendFactory, Op, Response, Session, SessionSafety, SessionTimeouts,
};

#[derive(Clone)]
struct RecordingFactory {
    scenario: FakeScenario,
    sink: Arc<Mutex<Option<RecordingSink>>>,
}

impl BackendFactory for RecordingFactory {
    fn create(&self, _options: &DesktopSessionOptions) -> CoreResult<Box<dyn Backend>> {
        let backend = FakeBackend::new(self.scenario.clone());
        *self.sink.lock().unwrap() = Some(backend.sink());
        Ok(Box::new(backend))
    }
}

async fn capture(session: &Session, target: &str) -> CaptureResult {
    let response = session
        .submit(Op::Capture(CaptureParams {
            target: target.into(),
            caps: None,
            exclude_window_titles: None,
        }))
        .wait()
        .await
        .unwrap();
    let Response::Capture(capture) = response else {
        panic!("expected capture")
    };
    capture
}

#[tokio::test]
async fn per_call_display_frames_survive_other_target_captures_without_reopening() {
    let scenario = FakeScenario::from_json(include_str!(
        "../../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json"
    ))
    .unwrap();
    let supervisor = Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))));
    supervisor.set_live(StopPathId::Global, true);
    let safety = SessionSafety {
        supervisor,
        audit: Box::new(|_| {}),
        control_slot: senpi_desktop_session::ControlSlot::new(),
    };
    let factory = RecordingFactory { scenario, sink: Arc::new(Mutex::new(None)) };
    let session = Session::start_supervised(
        factory.clone(),
        SessionTimeouts::default(),
        safety,
    )
    .unwrap();
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .unwrap();

    let desktop = capture(&session, "desktop").await;
    let selected = capture(&session, "display:2").await;
    let all = capture(&session, "display:all").await;
    assert_eq!(
        (selected.source_width, selected.source_height),
        (2880, 1800)
    );
    assert_eq!((all.source_width, all.source_height), (4800, 1800));
    assert_eq!(selected.target, "display:2");
    assert_ne!(selected.frame_id, desktop.frame_id);
    for (target, frame_id) in [
        ("desktop", desktop.frame_id),
        ("display:2", selected.frame_id.clone()),
    ] {
        let moved = session
            .submit(Op::MoveMouse(PointParams {
                target: target.into(),
                x: 20.0,
                y: 10.0,
                frame_id: Some(frame_id),
                opts: None,
            }))
            .wait()
            .await;
        assert_eq!(moved, Ok(Response::Unit));
    }
    let ops = factory.sink.lock().unwrap().as_ref().unwrap().ops();
    assert!(ops.contains(&SinkOp::Pointer {
        target: Target::parse("display:2"),
        event: RecordedPointer::Move { at: DesktopPoint { x: 1930.0, y: 5.0 } },
        mode: DeliveryMode::Background,
    }), "display:2 pixels must map through that display's origin and scale");
    let wrong_frame = session
        .submit(Op::MoveMouse(PointParams {
            target: "desktop".into(),
            x: 20.0,
            y: 10.0,
            frame_id: Some(selected.frame_id),
            opts: None,
        }))
        .wait()
        .await
        .unwrap_err();
    assert_eq!(wrong_frame.code, ErrorCode::InvalidCoordinateFrame);
    let invalid = session
        .submit(Op::Capture(CaptureParams {
            target: "display:missing".into(),
            caps: None,
            exclude_window_titles: None,
        }))
        .wait()
        .await
        .unwrap_err();
    assert_eq!(invalid.code, ErrorCode::InvalidTarget);
}
