//! The session's intervention policy (DESIGN 7, Q decision 1): under
//! `continue` the user's presses are recorded and nothing waits or stops;
//! under `pause`, the engine default, today's waits and refusals stay.
//! Replayed over `intervention-continue.json` with per-scalar typing, as the
//! macOS backend posts, and the user's key landing before the fifth scalar.

use std::sync::Arc;

use image::RgbaImage;
use parking_lot::Mutex;
use senpi_desktop_backend_fake::{FakeBackend, FakeMethod, FakeScenario, Faults, FakeUserInput, RecordingSink, SinkOp};
use senpi_desktop_core::ax::AxBackend;
use senpi_desktop_core::backend::{Backend, DeliveryMode, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::protocol_params::{CaptureParams, TypeTextParams};
use senpi_desktop_core::report::{ActionReport, Delivered, Disposition, ReportMode};
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopSessionOptions, DesktopWindow, FrontWindow,
    InterventionPolicy, Target,
};
use senpi_desktop_core::user_input::UserPressKind;
use senpi_desktop_safety::{Clock, FakeClock, StopPathId, Supervisor};
use serde_json::Value;

use crate::mutate::SessionSafety;
use crate::request::{Op, Response};
use crate::selection::BackendFactory;
use crate::worker::Worker;

const SCENARIO: &str = include_str!("../../../senpi-desktop-backend-fake/fixtures/intervention-continue.json");
const NOTES: u32 = 4242;

/// The fake typing one scalar per post, so a press can land mid-text.
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

type Built = Arc<Mutex<Option<(RecordingSink, Faults, Arc<FakeUserInput>)>>>;

struct ScalarFactory {
    scenario: FakeScenario,
    built: Built,
}

impl BackendFactory for ScalarFactory {
    fn create(&self, _options: &DesktopSessionOptions) -> CoreResult<Box<dyn Backend>> {
        let backend = FakeBackend::new(self.scenario.clone());
        *self.built.lock() = Some((backend.sink(), backend.faults(), backend.user_input()));
        Ok(Box::new(ScalarTyping(backend)))
    }
}

struct Session {
    worker: Worker,
    sink: RecordingSink,
    faults: Faults,
    user_input: Arc<FakeUserInput>,
    clock: Arc<FakeClock>,
    supervisor: Arc<Supervisor>,
}

/// An object-mode session over the scenario without its scripted press (the
/// tests land the user's key before a chosen scalar instead), opened with
/// `intervention`, or with the engine default when `None`.
fn session(intervention: Option<InterventionPolicy>) -> Session {
    let mut overlay: Value = serde_json::from_str(SCENARIO).expect("scenario is JSON");
    overlay.as_object_mut().expect("scenario is an object").remove("user_presses");
    let scenario = FakeScenario::from_json(&overlay.to_string()).expect("scenario parses");
    let built = Built::default();
    let clock = Arc::new(FakeClock::new(0));
    let supervisor = Arc::new(Supervisor::new(Arc::clone(&clock) as Arc<dyn Clock>));
    supervisor.set_live(StopPathId::Global, true);
    let safety = SessionSafety {
        supervisor: Arc::clone(&supervisor),
        audit: Box::new(|_| {}),
        control_slot: crate::grant::ControlSlot::new(),
    };
    let factory = ScalarFactory { scenario, built: Arc::clone(&built) };
    let capabilities = Arc::new(Mutex::new(DesktopCapabilities::unavailable()));
    let display = (Arc::default(), crate::screen_notes::ScreenNotes::default());
    let mut worker = Worker::new(Box::new(factory), capabilities, Arc::new(Mutex::new(ReportMode::Null)), safety, display);
    let mut options = DesktopSessionOptions { report_mode: ReportMode::Object, ..DesktopSessionOptions::default() };
    if let Some(intervention) = intervention {
        options.intervention = intervention;
    }
    worker.open(options);
    worker.attach_user_input_feed();
    let (sink, faults, user_input) = built.lock().clone().expect("open built a backend");
    Session { worker, sink, faults, user_input, clock, supervisor }
}

impl Session {
    /// The user presses a key in Notes right before scalar `index` (from 0)
    /// of the next typed text goes out.
    fn user_key_before_scalar(&self, index: usize) {
        for _ in 0..index {
            self.faults.on_next(FakeMethod::TypeText, || {});
        }
        let feed = Arc::clone(&self.user_input);
        self.faults.on_next(FakeMethod::TypeText, move || feed.press(NOTES, UserPressKind::Key));
    }

    fn type_text(&mut self, text: &str) -> CoreResult<Response> {
        let op = Op::TypeText(TypeTextParams { target: "101".to_owned(), text: text.to_owned(), opts: None });
        self.worker.process(op, &|| false)
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

    /// The user's key presses and clicks the session's record counted in Notes.
    fn recorded_presses(&self) -> Option<u64> {
        self.worker.intervention.inputs.state_of(NOTES).map(|(inputs, _)| inputs)
    }
}

fn action(response: Response) -> ActionReport {
    match response {
        Response::Action(report) => *report,
        other => panic!("expected an action report, got {other:?}"),
    }
}

fn error_report(error: &DesktopError) -> senpi_desktop_core::error::ErrorReport {
    *error.report.clone().expect("object-mode errors carry a report")
}

#[test]
fn under_continue_a_user_key_at_scalar_4_does_not_stop_typing_and_is_recorded() {
    // Given: a continue session; the user presses a key in Notes after 4 of 10 scalars
    let mut session = session(Some(InterventionPolicy::Continue));
    session.user_key_before_scalar(4);
    // When
    let report = action(session.type_text("abcdefghij").expect("typed despite the user's key"));
    // Then: all 10 delivered, and the record still counts the user's key
    println!("replay intervention-continue.json (continue): {}", serde_json::to_string(&report).expect("serializes"));
    assert_eq!(report.delivered, Some(Delivered { count: 10, of: 10 }));
    assert_eq!(session.typed(), "abcdefghij");
    assert_eq!(session.recorded_presses(), Some(1));
}

#[test]
fn under_pause_a_user_key_at_scalar_4_stops_typing_with_4_of_10_delivered_unverified() {
    // Given: the same scenario in a pause session
    let mut session = session(Some(InterventionPolicy::Pause));
    session.user_key_before_scalar(4);
    // When
    let error = session.type_text("abcdefghij").expect_err("stopped at the user's key");
    // Then: today's behaviour
    let report = error_report(&error);
    println!("replay intervention-continue.json (pause): {}", serde_json::to_string(&error).expect("serializes"));
    assert_eq!(error.code, ErrorCode::UserIntervened);
    assert_eq!(report.delivered, Some(Delivered { count: 4, of: 10 }));
    assert_eq!(report.disposition, Some(Disposition::DELIVERED_UNVERIFIED));
    assert_eq!(session.typed(), "abcd");
    assert_eq!(session.recorded_presses(), Some(1));
}

#[test]
fn a_session_opened_without_an_intervention_option_pauses() {
    // Given: no option, as the daemon's own session and v1 hosts open
    let mut session = session(None);
    session.user_key_before_scalar(4);
    // When / Then: the engine default is pause
    let error = session.type_text("abcdefghij").expect_err("stopped at the user's key");
    assert_eq!(error.code, ErrorCode::UserIntervened);
    assert_eq!(session.typed(), "abcd");
}

#[test]
fn under_continue_the_takeover_gate_stays_but_input_never_waits_for_the_user_to_pause() {
    // Given: the session read Notes (frontmost), then the user typed there
    let mut session = session(Some(InterventionPolicy::Continue));
    let capture = CaptureParams { target: "101".to_owned(), caps: None, exclude_window_titles: None };
    let mut captured = None;
    session.worker.dispatch(Op::Capture(capture), &|| false, |reply| {
        captured = Some(reply.is_ok());
        true
    });
    assert_eq!(captured, Some(true), "the capture reached the caller");
    session.user_input.press(NOTES, UserPressKind::Key);
    session.worker.drain_user_input();
    // When / Then: the step-0 takeover gate still refuses keys right after the user's
    let gated = session.type_text("hi").expect_err("takeover gate");
    assert_eq!(gated.code, ErrorCode::BackgroundUnavailable);
    // When: 2 s later, still inside the 5 s quiet period pause would wait out
    session.clock.advance(2_000);
    session.supervisor.heartbeat(StopPathId::Global);
    let report = action(session.type_text("hi").expect("typed without waiting"));
    // Then: sent at once, the session clock never moving
    assert_eq!(report.delivered, Some(Delivered { count: 2, of: 2 }));
    assert_eq!(session.typed(), "hi");
    assert_eq!(session.recorded_presses(), Some(1));
}
