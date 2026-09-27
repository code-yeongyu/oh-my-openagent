use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use image::RgbaImage;
use parking_lot::Mutex;
use senpi_desktop_backend_fake::{FakeBackend, FakeScenario, RecordingSink, SinkOp};
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::backend::{Backend, DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, ErrorCode};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::protocol_params::{CaptureParams, PointParams};
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopSessionOptions, DesktopWindow, DisplaySelector,
    Target,
};
use senpi_desktop_safety::{FakeClock, StopPathId, Supervisor};
use senpi_desktop_session::{
    BackendFactory, BackendSelection, Op, Response, Session, SessionSafety, SessionTimeouts,
};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json"
);

fn scenario(overlay: &str) -> FakeScenario {
    let base = std::fs::read_to_string(Path::new(FIXTURE)).expect("fixture is readable");
    let mut json: serde_json::Value = serde_json::from_str(&base).expect("fixture is JSON");
    let overlay: serde_json::Value = serde_json::from_str(overlay).expect("overlay is JSON");
    for (key, value) in overlay.as_object().expect("overlay is an object") {
        json[key] = value.clone();
    }
    FakeScenario::from_json(&json.to_string()).expect("scenario parses")
}

fn start(overlay: &str, timeouts: SessionTimeouts) -> Session {
    let selection = BackendSelection::FakeScenario(Box::new(scenario(overlay)));
    Session::start(selection, timeouts).expect("session starts")
}

/// A live, fresh global stop path, so input passes the gate.
fn live_stop_path() -> SessionSafety {
    let supervisor = Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))));
    supervisor.set_live(StopPathId::Global, true);
    SessionSafety {
        supervisor,
        audit: Box::new(|_| {}),
    }
}

fn start_supervised(factory: impl BackendFactory) -> Session {
    Session::start_supervised(factory, SessionTimeouts::default(), live_stop_path()).expect("session starts")
}

fn capture_desktop() -> Op {
    Op::Capture(CaptureParams {
        target: "desktop".to_owned(),
        caps: None,
    })
}

fn click_desktop() -> Op {
    Op::Click(PointParams {
        target: "desktop".to_owned(),
        x: 10.0,
        y: 10.0,
        frame_id: None,
        opts: None,
    })
}

fn code(result: CoreResult<Response>) -> Option<ErrorCode> {
    result.err().map(|error| error.code)
}

#[test]
fn capabilities_before_open_report_the_selected_fake_backend() {
    // Given / When
    let session = start("{}", SessionTimeouts::default());
    // Then
    let capabilities = session.capabilities();
    assert_eq!(capabilities.backend, "fake");
    assert_eq!(capabilities.display_count, 2);
}

#[test]
fn an_unconstructible_backend_reports_unavailable_capabilities() {
    // Given / When
    let missing = BackendSelection::FakeFile("does/not/exist.json".into());
    let session = Session::start(missing, SessionTimeouts::default()).expect("session starts");
    // Then
    assert_eq!(session.capabilities(), DesktopCapabilities::unavailable());
}

#[tokio::test]
async fn backend_requests_before_open_fail_closed() {
    let session = start("{}", SessionTimeouts::default());
    assert_eq!(
        code(session.submit(Op::Displays).wait().await),
        Some(ErrorCode::Closed)
    );
}

#[tokio::test]
async fn requests_after_close_fail_closed_and_close_is_idempotent() {
    // Given
    let session = start("{}", SessionTimeouts::default());
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    // When
    session.close().wait().await.expect("closes");
    // Then
    assert_eq!(
        code(session.submit(Op::Displays).wait().await),
        Some(ErrorCode::Closed)
    );
    assert_eq!(session.close().wait().await, Ok(Response::Unit));
}

#[tokio::test]
async fn capture_returns_a_frame_that_later_clicks_map_through() {
    // Given
    let session = start_supervised(BackendSelection::FakeScenario(Box::new(scenario("{}"))));
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    // When
    let capture = session.submit(capture_desktop()).wait().await.expect("captures");
    // Then
    let Response::Capture(capture) = capture else {
        panic!("expected a capture, got {capture:?}");
    };
    assert_eq!((capture.source_width, capture.source_height), (4800, 1800));
    assert!(capture.data.is_some_and(|data| data.starts_with("iVBORw0KGgo")));
    assert_eq!(session.submit(click_desktop()).wait().await, Ok(Response::Unit));
}

#[tokio::test]
async fn a_session_started_without_a_supervisor_refuses_input() {
    // Given
    let session = start("{}", SessionTimeouts::default());
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    session.submit(capture_desktop()).wait().await.expect("captures");
    // When
    let clicked = session.submit(click_desktop()).wait().await;
    // Then
    assert_eq!(code(clicked), Some(ErrorCode::StopPathUnavailable));
}

#[tokio::test]
async fn a_request_past_its_deadline_fails_timeout() {
    // Given: capture blocks the session thread far past the deadline.
    let timeouts = SessionTimeouts {
        operation: Duration::from_millis(200),
        ..SessionTimeouts::default()
    };
    let session = start(r#"{"delay_ms": {"capture": 5000}}"#, timeouts);
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    // When / Then
    assert_eq!(
        code(session.submit(capture_desktop()).wait().await),
        Some(ErrorCode::Timeout)
    );
}

#[tokio::test]
async fn an_abandoned_request_never_reaches_the_backend() {
    // Given: a frame to click through, and a slow request occupying the thread.
    let factory = SharedSinkFactory::new(scenario(r#"{"delay_ms": {"windows": 300}}"#));
    let sinks = Arc::clone(&factory.sinks);
    let session = start_supervised(factory);
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    session.submit(capture_desktop()).wait().await.expect("captures");
    let slow = session.submit(Op::Windows);
    // When: the click's waiter gives up before the thread reaches it.
    drop(session.submit(click_desktop()));
    slow.wait().await.expect("windows answers");
    session
        .submit(Op::Displays)
        .wait()
        .await
        .expect("barrier answers");
    // Then
    let sink = sinks.lock().last().cloned().expect("open built a backend");
    assert!(!sink.ops().iter().any(|op| matches!(op, SinkOp::Pointer { .. })));
}

#[tokio::test]
async fn a_panicking_backend_fails_internal_and_the_session_keeps_serving() {
    // Given
    let session = Session::start(PanickingFactory, SessionTimeouts::default()).expect("session starts");
    session
        .open(DesktopSessionOptions::default())
        .wait()
        .await
        .expect("opens");
    // When
    let panicked = session.submit(Op::Displays).wait().await;
    // Then
    assert_eq!(code(panicked), Some(ErrorCode::Internal));
    assert_eq!(
        session.submit(Op::Windows).wait().await,
        Ok(Response::Windows(Vec::new()))
    );
}

#[test]
fn unit_replies_serialize_to_json_null() {
    assert_eq!(
        serde_json::to_value(Response::Unit).expect("serializes"),
        serde_json::Value::Null
    );
}

/// Fake backends whose op logs stay observable after the session boxes them.
struct SharedSinkFactory {
    scenario: FakeScenario,
    sinks: Arc<Mutex<Vec<RecordingSink>>>,
}

impl SharedSinkFactory {
    fn new(scenario: FakeScenario) -> Self {
        Self {
            scenario,
            sinks: Arc::default(),
        }
    }
}

impl BackendFactory for SharedSinkFactory {
    fn create(&self, _selector: DisplaySelector) -> CoreResult<Box<dyn Backend>> {
        let backend = FakeBackend::new(self.scenario.clone());
        self.sinks.lock().push(backend.sink());
        Ok(Box::new(backend))
    }
}

struct PanickingFactory;

impl BackendFactory for PanickingFactory {
    fn create(&self, _selector: DisplaySelector) -> CoreResult<Box<dyn Backend>> {
        Ok(Box::new(PanicsOnDisplays))
    }
}

struct PanicsOnDisplays;

impl Backend for PanicsOnDisplays {
    fn capabilities(&mut self) -> DesktopCapabilities {
        DesktopCapabilities::unavailable()
    }
    fn displays(&mut self) -> CoreResult<Vec<DesktopDisplay>> {
        panic!("scripted backend panic")
    }
    fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>> {
        Ok(Vec::new())
    }
    fn capture(&mut self, _: &Target, _: &CaptureCaps) -> CoreResult<(RgbaImage, FrameGeometry)> {
        unreachable!("capture is not exercised")
    }
    fn pointer(&mut self, _: &Target, _: PointerEvent, _: &FrameGeometry, _: DeliveryMode) -> CoreResult<()> {
        unreachable!("pointer is not exercised")
    }
    fn type_text(&mut self, _: &Target, _: &str, _: DeliveryMode) -> CoreResult<()> {
        unreachable!("type_text is not exercised")
    }
    fn key_chord(&mut self, _: &Target, _: &[KeyName], _: DeliveryMode) -> CoreResult<()> {
        unreachable!("key_chord is not exercised")
    }
    fn raise_window(&mut self, _: &str) -> CoreResult<()> {
        unreachable!("raise_window is not exercised")
    }
    fn ax(&mut self) -> Option<&mut dyn AxBackend> {
        None
    }
}
