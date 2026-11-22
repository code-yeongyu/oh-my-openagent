//! Epoch moves over the fake: a display change supersedes the old frame and
//! expires refs, a move mid-typing ends the request with the delivery
//! unknown, and a null-mode session is untouched.

use std::sync::Arc;

use image::RgbaImage;
use parking_lot::Mutex;
use senpi_desktop_backend_fake::{FakeBackend, FakeScenario, RecordingSink, SinkOp};
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::backend::{Backend, DeliveryMode, EpochSource, PointerEvent, ScreenProbe};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode, ErrorReport};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::protocol_params::{AxRefParams, CaptureParams, PointParams, TypeTextParams};
use senpi_desktop_core::protocol_results::{EpochChanged, EpochReason};
use senpi_desktop_core::report::{Delivered, Disposition, ReportMode};
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopSessionOptions, DesktopWindow, DisplaySelector,
    FrontWindow, ScreenState, Target,
};
use senpi_desktop_safety::{Clock, FakeClock, StopPathId, Supervisor};
use serde_json::{json, Value};

use super::EpochLog;
use crate::mutate::SessionSafety;
use crate::request::{Op, Response};
use crate::selection::BackendFactory;
use crate::worker::Worker;

const DISPLAY_CHANGE: &str = include_str!("../../../senpi-desktop-backend-fake/fixtures/v2-epoch-display.json");
const MID_CALL: &str = include_str!("../../../senpi-desktop-backend-fake/fixtures/v2-epoch-mid-call.json");

/// The fake typing one scalar per call, as the macOS backend posts, with a
/// screen whose lock state the test sets.
struct Scalar(FakeBackend, Arc<Mutex<ScreenState>>);

struct Screen(Arc<Mutex<ScreenState>>);

impl ScreenProbe for Screen {
    fn screen_state(&self, _display: Option<&DisplaySelector>) -> ScreenState {
        *self.0.lock()
    }
}

impl Backend for Scalar {
    fn capabilities(&mut self) -> DesktopCapabilities {
        self.0.capabilities()
    }
    fn displays(&mut self) -> CoreResult<Vec<DesktopDisplay>> {
        self.0.displays()
    }
    fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>> {
        self.0.windows()
    }
    fn capture(&mut self, target: &Target, caps: &CaptureCaps, exclude: &[String]) -> CoreResult<(RgbaImage, FrameGeometry)> {
        self.0.capture(target, caps, exclude)
    }
    fn pointer(&mut self, target: &Target, ev: PointerEvent, frame: &FrameGeometry, mode: DeliveryMode) -> CoreResult<()> {
        self.0.pointer(target, ev, frame, mode)
    }
    fn type_text(&mut self, target: &Target, text: &str, mode: DeliveryMode) -> CoreResult<()> {
        self.0.type_text(target, text, mode)
    }
    fn type_text_interruptible(
        &mut self,
        target: &Target,
        text: &str,
        mode: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        for scalar in text.chars() {
            check_stop()?;
            self.0.type_text(target, &scalar.to_string(), mode)?;
            delivered();
        }
        Ok(())
    }
    fn key_chord(&mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode) -> CoreResult<()> {
        self.0.key_chord(target, keys, mode)
    }
    fn raise_window(&mut self, id: &str) -> CoreResult<()> {
        self.0.raise_window(id)
    }
    fn ax(&mut self) -> Option<&mut dyn AxBackend> {
        self.0.ax()
    }
    fn release_all(&mut self) -> CoreResult<()> {
        self.0.release_all()
    }
    fn front_window(&mut self) -> CoreResult<Option<FrontWindow>> {
        self.0.front_window()
    }
    fn screen_locked(&mut self) -> CoreResult<bool> {
        self.0.screen_locked()
    }
    fn screen_probe(&self) -> Option<Arc<dyn ScreenProbe>> {
        Some(Arc::new(Screen(Arc::clone(&self.1))))
    }
    fn epoch_source(&self) -> Option<Arc<dyn EpochSource>> {
        self.0.epoch_source()
    }
}

struct Factory {
    scenario: FakeScenario,
    screen: Arc<Mutex<ScreenState>>,
    sink: Arc<Mutex<Option<RecordingSink>>>,
}

impl BackendFactory for Factory {
    fn create(&self, _options: &DesktopSessionOptions) -> CoreResult<Box<dyn Backend>> {
        let backend = FakeBackend::new(self.scenario.clone());
        *self.sink.lock() = Some(backend.sink());
        Ok(Box::new(Scalar(backend, Arc::clone(&self.screen))))
    }
}

struct Session {
    worker: Worker,
    sink: RecordingSink,
    log: EpochLog,
    screen: Arc<Mutex<ScreenState>>,
}

fn open(scenario: &Value, report_mode: ReportMode) -> Session {
    let scenario = FakeScenario::from_json(&scenario.to_string()).expect("scenario parses");
    let supervisor = Arc::new(Supervisor::new(Arc::new(FakeClock::new(0)) as Arc<dyn Clock>));
    supervisor.set_live(StopPathId::Global, true);
    let safety = SessionSafety {
        supervisor,
        audit: Box::new(|_| {}),
        control_slot: crate::grant::ControlSlot::new(),
    };
    let screen = Arc::new(Mutex::new(ScreenState::default()));
    let sink = Arc::new(Mutex::new(None));
    let factory = Factory { scenario, screen: Arc::clone(&screen), sink: Arc::clone(&sink) };
    let mut worker = Worker::new(
        Box::new(factory),
        Arc::new(Mutex::new(DesktopCapabilities::unavailable())),
        Arc::new(Mutex::new(ReportMode::Null)),
        safety,
        (Arc::default(), crate::screen_notes::ScreenNotes::default()),
    );
    let log = EpochLog::default();
    worker.epochs = super::Epochs::new(log.clone());
    worker.open(DesktopSessionOptions { report_mode, ..DesktopSessionOptions::default() });
    let sink = sink.lock().clone().expect("open built a backend");
    Session { worker, sink, log, screen }
}

impl Session {
    fn process(&mut self, op: Op) -> CoreResult<Response> {
        self.worker.process(op, &|| false)
    }

    fn capture(&mut self) -> String {
        let params = CaptureParams { target: "101".to_owned(), caps: None, exclude_window_titles: None };
        match self.process(Op::Capture(params)) {
            Ok(Response::Capture(capture)) => capture.frame_id,
            other => panic!("capture failed: {other:?}"),
        }
    }

    fn click(&mut self, frame: &str) -> CoreResult<Response> {
        self.process(Op::Click(PointParams {
            target: "101".to_owned(),
            x: 20.0,
            y: 20.0,
            frame_id: Some(frame.to_owned()),
            opts: None,
        }))
    }

    fn focused_ref(&mut self) -> String {
        match self.process(Op::AxFocused) {
            Ok(Response::MaybeNode(Some(node))) => node.ref_,
            other => panic!("ax.focused failed: {other:?}"),
        }
    }

    fn clicks(&self) -> usize {
        self.sink.ops().iter().filter(|op| matches!(op, SinkOp::Pointer { .. })).count()
    }

    fn typed(&self) -> String {
        self.sink
            .ops()
            .iter()
            .filter_map(|op| match op {
                SinkOp::TypeText { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect()
    }
}

fn scenario(json: &str) -> Value {
    serde_json::from_str(json).expect("fixture is JSON")
}

fn report(error: &DesktopError) -> ErrorReport {
    *error.report.clone().expect("object-mode errors carry a report")
}

fn type_text(text: &str) -> Op {
    Op::TypeText(TypeTextParams { target: "101".to_owned(), text: text.to_owned(), opts: None })
}

#[test]
fn a_display_change_supersedes_the_old_frame_and_announces_epoch_changed_display() {
    // Given: window 101 captured, then a display reconfiguration lands during the next request.
    let mut session = open(&scenario(DISPLAY_CHANGE), ReportMode::Object);
    let frame = session.capture();
    session.process(Op::Windows).expect("windows");
    let announced = session.log.take_announcements();
    // When
    let error = session.click(&frame).expect_err("refused");
    // Then
    println!("replay v2-epoch-display.json: {announced:?} then {}", serde_json::to_string(&error).expect("serializes"));
    assert_eq!(announced, [EpochChanged { reason: EpochReason::Display }]);
    assert_eq!(error.code, ErrorCode::InvalidCoordinateFrame);
    assert_eq!(report(&error).reason.as_deref(), Some("superseded"));
    assert_eq!(report(&error).disposition, Some(Disposition::NOT_DELIVERED_SAFE));
    assert_eq!(session.clicks(), 0);
    assert!(session.log.take_announcements().is_empty(), "each move is announced once");
}

#[test]
fn a_new_capture_after_the_move_takes_input_again() {
    let mut session = open(&scenario(DISPLAY_CHANGE), ReportMode::Object);
    session.capture();
    session.process(Op::Windows).expect("windows");
    let fresh = session.capture();
    session.click(&fresh).expect("the fresh frame takes input");
    assert_eq!(session.clicks(), 1);
}

#[test]
fn without_a_move_the_same_frame_stays_valid() {
    // Given: the scenario scripts no epoch move.
    let mut quiet = scenario(DISPLAY_CHANGE);
    quiet.as_object_mut().expect("object").remove("displays_change");
    let mut session = open(&quiet, ReportMode::Object);
    let frame = session.capture();
    session.process(Op::Windows).expect("windows");
    // When / Then
    session.click(&frame).expect("still the latest frame");
    assert!(session.log.take_announcements().is_empty());
}

#[test]
fn a_ref_from_before_the_move_is_stale() {
    // Given
    let mut session = open(&scenario(DISPLAY_CHANGE), ReportMode::Object);
    let reference = session.focused_ref();
    session.capture();
    session.process(Op::Windows).expect("windows");
    // When
    let error = session.process(Op::AxNode(AxRefParams { ref_: reference.clone() })).expect_err("expired");
    // Then
    assert_eq!(error.code, ErrorCode::StaleRef, "{reference}: {error:?}");
}

#[test]
fn a_null_mode_session_keeps_frames_and_refs_and_announces_nothing() {
    // Given: the same display change in a session without reportMode.
    let mut session = open(&scenario(DISPLAY_CHANGE), ReportMode::Null);
    let reference = session.focused_ref();
    let frame = session.capture();
    session.process(Op::Windows).expect("windows");
    // When
    let clicked = session.click(&frame);
    // Then
    println!("replay v2-epoch-display.json (null mode): {clicked:?}");
    assert!(matches!(clicked, Ok(Response::Unit)), "{clicked:?}");
    assert!(session.process(Op::AxNode(AxRefParams { ref_: reference })).is_ok());
    assert!(session.log.take_announcements().is_empty());
}

#[test]
fn a_move_after_char_3_of_10_ends_unknown_with_delivered_3_of_10() {
    // Given: the epoch moves after the third scalar went out.
    let mut mid = scenario(MID_CALL);
    mid["epoch_events"] = json!([{"after_call": "type_text", "nth": 2, "reason": "display"}]);
    let mut session = open(&mid, ReportMode::Object);
    // When
    let error = session.process(type_text("abcdefghij")).expect_err("interrupted");
    // Then
    let report = report(&error);
    println!("replay v2-epoch-mid-call.json: {}", serde_json::to_string(&error).expect("serializes"));
    assert_eq!(error.code, ErrorCode::InvalidCoordinateFrame);
    assert_eq!(report.reason.as_deref(), Some("superseded"));
    assert_eq!(report.disposition, Some(Disposition::UNKNOWN));
    assert_eq!(report.delivered, Some(Delivered { count: 3, of: 10 }));
    assert_eq!(session.typed(), "abc");
    assert_eq!(session.log.take_announcements(), [EpochChanged { reason: EpochReason::Display }]);
}

#[test]
fn a_move_before_the_first_char_refuses_with_nothing_sent() {
    // Given: the screen locks after the request was admitted, before any key.
    let mut session = open(&scenario(MID_CALL), ReportMode::Object);
    let screen = Arc::clone(&session.screen);
    session.worker.epochs.arm(
        true,
        None,
        Some(Arc::new(LocksOnSecondRead { screen, reads: Mutex::new(0) })),
    );
    // When
    let error = session.process(type_text("abc")).expect_err("refused");
    // Then
    let report = report(&error);
    assert_eq!(error.code, ErrorCode::InvalidCoordinateFrame);
    assert_eq!(report.reason.as_deref(), Some("superseded"));
    assert_eq!(report.disposition, Some(Disposition::NOT_DELIVERED_SAFE));
    assert_eq!(session.typed(), "");
    assert_eq!(session.log.take_announcements(), [EpochChanged { reason: EpochReason::Lock }]);
}

/// Reads unlocked at arming and at the request's start, locked after.
struct LocksOnSecondRead {
    screen: Arc<Mutex<ScreenState>>,
    reads: Mutex<u32>,
}

impl ScreenProbe for LocksOnSecondRead {
    fn screen_state(&self, _display: Option<&DisplaySelector>) -> ScreenState {
        let mut reads = self.reads.lock();
        *reads += 1;
        let mut state = *self.screen.lock();
        state.locked = *reads > 2;
        state
    }
}

#[test]
fn a_lock_between_requests_supersedes_frames_with_reason_lock() {
    // Given
    let mut session = open(&scenario(MID_CALL), ReportMode::Object);
    let frame = session.capture();
    // When: the screen locks before the next request.
    session.screen.lock().locked = true;
    let error = session.click(&frame).expect_err("refused");
    // Then
    assert_eq!(error.code, ErrorCode::InvalidCoordinateFrame, "{error:?}");
    assert_eq!(report(&error).reason.as_deref(), Some("superseded"));
    assert_eq!(session.log.take_announcements(), [EpochChanged { reason: EpochReason::Lock }]);
}

#[test]
fn a_space_unsupported_refusal_moves_the_epoch() {
    // Given: the first click is refused because window 101 sits on another Space.
    let mut spaced = scenario(MID_CALL);
    spaced["fail_next"] = json!([{"method": "click", "code": "SpaceUnsupported"}]);
    let mut session = open(&spaced, ReportMode::Object);
    let frame = session.capture();
    let refused = session.click(&frame).expect_err("on another Space");
    assert_eq!(refused.code, ErrorCode::SpaceUnsupported);
    // When
    let error = session.click(&frame).expect_err("superseded");
    // Then
    assert_eq!(report(&error).reason.as_deref(), Some("superseded"));
    assert_eq!(session.log.take_announcements(), [EpochChanged { reason: EpochReason::Space }]);
}
