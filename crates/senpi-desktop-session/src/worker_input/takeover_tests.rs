//! DESIGN 7 step 0 (the takeover gate), delivered counts of interrupted
//! typing, and the secure-field warning, replayed over the
//! `v2-user-active-in-target.json` and `typetext-interrupted.json` scenarios.

use std::sync::Arc;

use image::RgbaImage;
use parking_lot::Mutex;
use senpi_desktop_backend_fake::{FakeBackend, FakeScenario, RecordingSink, SinkOp};
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::backend::{Backend, DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::protocol_params::{KeyChordParams, TypeTextParams};
use senpi_desktop_core::report::{ActionReport, Delivered, Disposition, ReportMode};
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopSessionOptions, DesktopWindow, FrontWindow, Target,
};
use senpi_desktop_safety::{Clock, FakeClock, StopPathId, StopSource, Supervisor};
use serde_json::{json, Value};

use crate::mutate::SessionSafety;
use crate::request::{Op, Response};
use crate::selection::BackendFactory;
use crate::test_support::{harness_opened, Harness};
use crate::worker::Worker;

const USER_ACTIVE: &str = include_str!("../../../senpi-desktop-backend-fake/fixtures/v2-user-active-in-target.json");
const INTERRUPTED: &str = include_str!("../../../senpi-desktop-backend-fake/fixtures/typetext-interrupted.json");

fn fixture(json: &str) -> Value {
    serde_json::from_str(json).expect("fixture is JSON")
}

fn options(report_mode: ReportMode) -> DesktopSessionOptions {
    DesktopSessionOptions { report_mode, ..DesktopSessionOptions::default() }
}

/// A session over `overlay` whose feed has stamped every press already in
/// the scenario's past at session time 0.
fn opened(overlay: &Value, report_mode: ReportMode) -> Harness {
    let mut harness = harness_opened(overlay, crate::grant::ControlSlot::new(), options(report_mode));
    harness.worker.attach_user_input_feed();
    harness.worker.drain_user_input();
    harness
}

fn type_text(text: &str) -> Op {
    Op::TypeText(TypeTextParams { target: "101".to_owned(), text: text.to_owned(), opts: None })
}

fn typed(sink: &RecordingSink) -> String {
    sink.ops()
        .iter()
        .filter_map(|op| match op {
            SinkOp::TypeText { text, .. } => Some(text.clone()),
            _ => None,
        })
        .collect()
}

fn report(error: &DesktopError) -> senpi_desktop_core::error::ErrorReport {
    *error.report.clone().expect("object-mode errors carry a report")
}

fn action(response: Response) -> ActionReport {
    match response {
        Response::Action(report) => *report,
        other => panic!("expected an action report, got {other:?}"),
    }
}

#[test]
fn frontmost_target_used_500_ms_ago_refuses_background_keys_and_sends_nothing() {
    // Given: Notes (pid 4242) is frontmost and the user pressed a key there 500 ms ago.
    let mut harness = opened(&fixture(USER_ACTIVE), ReportMode::Object);
    harness.pass_ms(500);
    // When
    let error = harness.process(type_text("hello")).expect_err("refused");
    // Then
    let report = report(&error);
    println!("replay v2-user-active-in-target.json: {}", serde_json::to_string(&error).expect("serializes"));
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert_eq!(report.reason.as_deref(), Some("user_active_in_target"));
    assert_eq!(report.disposition, Some(Disposition::NOT_DELIVERED_AFTER_USER));
    assert_eq!(report.delivered, None);
    assert_eq!(typed(&harness.sink), "");
}

#[test]
fn frontmost_target_used_500_ms_ago_refuses_a_background_key_chord() {
    let mut harness = opened(&fixture(USER_ACTIVE), ReportMode::Object);
    harness.pass_ms(500);
    let chord = Op::KeyChord(KeyChordParams { target: "101".to_owned(), keys: vec!["enter".to_owned()], opts: None, force: false });
    let error = harness.process(chord).expect_err("refused");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert_eq!(report(&error).reason.as_deref(), Some("user_active_in_target"));
    assert!(!harness.sink.ops().iter().any(|op| matches!(op, SinkOp::KeyChord { .. })));
}

#[test]
fn frontmost_target_idle_for_3000_ms_takes_the_keys() {
    let mut harness = opened(&fixture(USER_ACTIVE), ReportMode::Object);
    harness.pass_ms(3_000);
    let report = action(harness.process(type_text("hello")).expect("typed"));
    assert_eq!(report.disposition, Disposition::DELIVERED_UNVERIFIED);
    assert_eq!(typed(&harness.sink), "hello");
}

#[test]
fn a_recent_press_in_a_target_that_is_not_frontmost_does_not_refuse() {
    // Given: window 101 (pid 4242) sits behind the focused window 202 of
    // another app, and the user pressed a key in 4242 500 ms ago.
    let mut overlay = fixture(USER_ACTIVE);
    let mut behind = overlay["windows"][0].clone();
    behind["focused"] = json!(false);
    let front = json!({"id": "202", "title": "Terminal", "app": "Terminal", "pid": 77, "x": 1000, "y": 120,
                       "width": 400, "height": 300, "focused": true, "elevated": null});
    overlay["windows"] = json!([behind, front]);
    overlay["frontmost_pid"] = json!(77);
    let mut harness = opened(&overlay, ReportMode::Object);
    harness.pass_ms(500);
    // When / Then
    harness.process(type_text("hello")).expect("typed");
    assert_eq!(typed(&harness.sink), "hello");
}

#[test]
fn a_null_mode_session_keeps_todays_path_even_while_the_user_types() {
    let mut harness = opened(&fixture(USER_ACTIVE), ReportMode::Null);
    harness.pass_ms(500);
    let response = harness.process(type_text("hello")).expect("typed");
    assert!(matches!(response, Response::Unit));
    assert_eq!(typed(&harness.sink), "hello");
}

#[test]
fn foreground_typing_is_not_gated() {
    // A foreground request needs a control grant; without one it is refused
    // ControlRequired, never by the takeover gate.
    let mut harness = opened(&fixture(USER_ACTIVE), ReportMode::Object);
    harness.pass_ms(500);
    let op = Op::TypeText(TypeTextParams {
        target: "101".to_owned(),
        text: "hello".to_owned(),
        opts: crate::test_support::delivery("foreground"),
    });
    let error = harness.process(op).expect_err("needs control");
    assert_ne!(report(&error).reason.as_deref(), Some("user_active_in_target"));
}

#[test]
fn typing_into_a_secure_field_reports_the_warning_and_an_unverifiable_effect() {
    // Given: the hit at the focused text area's center is a secure field.
    let mut overlay = fixture(INTERRUPTED);
    overlay["hit_at"] = json!([{"x": 500.0, "y": 410.0, "role": "textfield", "label": "Password", "secure": true}]);
    let mut harness = opened(&overlay, ReportMode::Object);
    // When
    let report = action(harness.process(type_text("hunter2")).expect("typed"));
    // Then
    assert_eq!(report.warning.as_deref(), Some("secure_field"));
    assert_eq!(report.effect, senpi_desktop_core::report::ActionEffect::Unverifiable);
    assert_eq!(report.disposition, Disposition::DELIVERED_UNVERIFIED);
}

#[test]
fn typing_into_a_plain_field_carries_no_warning() {
    let mut harness = opened(&fixture(INTERRUPTED), ReportMode::Object);
    let report = action(harness.process(type_text("hello")).expect("typed"));
    assert_eq!(report.warning, None);
}

/// The fake with per-scalar typing, as the macOS backend posts: the fake
/// itself sends typed text in chunks of eight scalars.
struct ScalarTyping(FakeBackend);

impl Backend for ScalarTyping {
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
    fn restore_front_window(&mut self, front: &FrontWindow) -> CoreResult<()> {
        self.0.restore_front_window(front)
    }
    fn restore_key_focus(&mut self, front: &FrontWindow) -> CoreResult<()> {
        self.0.restore_key_focus(front)
    }
    fn screen_locked(&mut self) -> CoreResult<bool> {
        self.0.screen_locked()
    }
    fn user_input_feed(&mut self) -> Option<Arc<dyn senpi_desktop_core::user_input::UserInputFeed>> {
        self.0.user_input_feed()
    }
}

struct ScalarFactory {
    scenario: FakeScenario,
    sink: Arc<Mutex<Option<RecordingSink>>>,
}

impl BackendFactory for ScalarFactory {
    fn create(&self, _options: &DesktopSessionOptions) -> CoreResult<Box<dyn Backend>> {
        let backend = FakeBackend::new(self.scenario.clone());
        *self.sink.lock() = Some(backend.sink());
        Ok(Box::new(ScalarTyping(backend)))
    }
}

/// An object-mode session over `typetext-interrupted.json` with per-scalar
/// typing and a live global stop path.
fn scalar_session() -> (Worker, RecordingSink, Arc<Supervisor>) {
    let scenario = FakeScenario::from_json(INTERRUPTED).expect("scenario parses");
    let sink = Arc::new(Mutex::new(None));
    let clock = Arc::new(FakeClock::new(0));
    let supervisor = Arc::new(Supervisor::new(clock as Arc<dyn Clock>));
    supervisor.set_live(StopPathId::Global, true);
    let safety = SessionSafety {
        supervisor: Arc::clone(&supervisor),
        audit: Box::new(|_| {}),
        control_slot: crate::grant::ControlSlot::new(),
    };
    let factory = ScalarFactory { scenario, sink: Arc::clone(&sink) };
    let capabilities = Arc::new(Mutex::new(DesktopCapabilities::unavailable()));
    let report_mode = Arc::new(Mutex::new(ReportMode::Null));
    let display = (Arc::default(), crate::screen_notes::ScreenNotes::default());
    let mut worker = Worker::new(Box::new(factory), capabilities, report_mode, safety, display);
    worker.open(options(ReportMode::Object));
    let sink = sink.lock().clone().expect("open built a backend");
    (worker, sink, supervisor)
}

#[test]
fn type_text_of_10_cancelled_after_4_reports_delivered_4_of_10_unverified_unsafe() {
    // Given
    let (mut worker, sink, _supervisor) = scalar_session();
    let probe = sink.clone();
    let cancelled = move || typed(&probe).chars().count() >= 4;
    // When
    let error = worker.process(type_text("abcdefghij"), &cancelled).expect_err("cancelled");
    // Then
    let report = report(&error);
    println!("replay typetext-interrupted.json: {}", serde_json::to_string(&error).expect("serializes"));
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(report.delivered, Some(Delivered { count: 4, of: 10 }));
    assert_eq!(report.disposition, Some(Disposition::DELIVERED_UNVERIFIED));
    assert_eq!(typed(&sink), "abcd");
}

#[test]
fn type_text_of_10_stopped_after_4_reports_delivered_4_of_10_unverified_unsafe() {
    let (mut worker, sink, supervisor) = scalar_session();
    let probe = sink.clone();
    let stop = move || {
        if typed(&probe).chars().count() >= 4 {
            supervisor.trigger_stop(StopSource::Hotkey);
        }
        false
    };
    let error = worker.process(type_text("abcdefghij"), &stop).expect_err("suspended");
    let report = report(&error);
    assert_eq!(error.code, ErrorCode::Suspended);
    assert_eq!(report.delivered, Some(Delivered { count: 4, of: 10 }));
    assert_eq!(report.disposition, Some(Disposition::DELIVERED_UNVERIFIED));
    assert_eq!(typed(&sink), "abcd");
}
