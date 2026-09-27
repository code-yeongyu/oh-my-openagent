//! A worker over the fake backend with a live stop path, its op log, its
//! failure and panic injection, its clock, and every audit event it emitted.

mod panicky;

use std::sync::Arc;

pub(crate) use panicky::Panics;
use parking_lot::Mutex;
use senpi_desktop_backend_fake::{FakeBackend, FakeScenario, Faults, RecordingSink, SinkOp};
use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::protocol_params::{CaptureParams, PointParams};
use senpi_desktop_core::protocol_results::AuditEvent;
use senpi_desktop_core::types::{
    DesktopCapabilities, DesktopSessionOptions, DisplaySelector, PointerOptions, Target,
};
use senpi_desktop_safety::{Clock, FakeClock, MutatingAction, StopPathId, Supervisor};
use serde_json::{json, Value};

use crate::mutate::{Mutation, SessionSafety};
use crate::request::{Op, Response};
use crate::selection::BackendFactory;
use crate::worker::Worker;

const FIXTURE: &str = include_str!("../../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json");

pub(crate) struct Harness {
    pub(crate) worker: Worker,
    pub(crate) sink: RecordingSink,
    pub(crate) faults: Faults,
    pub(crate) panics: Panics,
    pub(crate) clock: Arc<FakeClock>,
    pub(crate) supervisor: Arc<Supervisor>,
    pub(crate) audits: Arc<Mutex<Vec<AuditEvent>>>,
}

type Built = Arc<Mutex<Option<(RecordingSink, Faults)>>>;

struct Factory {
    scenario: FakeScenario,
    built: Built,
    panics: Panics,
}

impl BackendFactory for Factory {
    fn create(&self, _selector: DisplaySelector) -> CoreResult<Box<dyn Backend>> {
        let backend = FakeBackend::new(self.scenario.clone());
        *self.built.lock() = Some((backend.sink(), backend.faults()));
        Ok(Box::new(panicky::PanickyFake {
            inner: backend,
            panics: self.panics.clone(),
        }))
    }
}

/// An open session over the fixture with `overlay`'s top-level keys
/// replaced, and a live, fresh global stop path.
pub(crate) fn harness(overlay: &Value) -> Harness {
    let mut json: Value = serde_json::from_str(FIXTURE).expect("fixture is JSON");
    for (key, value) in overlay.as_object().expect("overlay is an object") {
        json[key] = value.clone();
    }
    let scenario = FakeScenario::from_json(&json.to_string()).expect("scenario parses");
    let built = Built::default();
    let clock = Arc::new(FakeClock::new(0));
    let supervisor = Arc::new(Supervisor::new(Arc::clone(&clock) as Arc<dyn Clock>));
    supervisor.set_live(StopPathId::Global, true);
    let audits = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&audits);
    let safety = SessionSafety {
        supervisor: Arc::clone(&supervisor),
        audit: Box::new(move |event| recorded.lock().push(event.clone())),
    };
    let panics = Panics::default();
    let factory = Factory {
        scenario,
        built: Arc::clone(&built),
        panics: panics.clone(),
    };
    let capabilities = Arc::new(Mutex::new(DesktopCapabilities::unavailable()));
    let mut worker = Worker::new(Box::new(factory), capabilities, safety);
    worker.open(DesktopSessionOptions::default());
    let (sink, faults) = built.lock().clone().expect("open built a backend");
    Harness {
        worker,
        sink,
        faults,
        panics,
        clock,
        supervisor,
        audits,
    }
}

impl Harness {
    /// Serves `op` as a request whose waiter never gives up.
    pub(crate) fn process(&mut self, op: Op) -> CoreResult<Response> {
        self.worker.process(op, &|| false)
    }

    /// Captures `target` and returns the frame id.
    pub(crate) fn capture(&mut self, target: &str) -> String {
        let params = CaptureParams {
            target: target.to_owned(),
            caps: None,
        };
        match self.process(Op::Capture(params)) {
            Ok(Response::Capture(capture)) => capture.frame_id,
            other => panic!("capture of {target} failed: {other:?}"),
        }
    }

    /// The ref of the fixture's focused text area.
    pub(crate) fn focused_ref(&mut self) -> String {
        match self.process(Op::AxFocused) {
            Ok(Response::MaybeNode(Some(node))) => node.ref_,
            other => panic!("no focused element: {other:?}"),
        }
    }

    pub(crate) fn audits(&self) -> Vec<AuditEvent> {
        self.audits.lock().clone()
    }
}

pub(crate) fn delivery(mode: &str) -> Option<PointerOptions> {
    Some(PointerOptions {
        delivery_mode: Some(mode.to_owned()),
        ..PointerOptions::default()
    })
}

/// A click at pixel (10, 10) of `frame_id`, a capture of window `101`.
pub(crate) fn click_window(frame_id: &str, opts: Option<PointerOptions>) -> Op {
    Op::Click(PointParams {
        target: "101".to_owned(),
        x: 10.0,
        y: 10.0,
        frame_id: Some(frame_id.to_owned()),
        opts,
    })
}

/// Window `101` behind the focused window `202`; the cursor rests at (960, 540).
pub(crate) fn two_windows() -> Value {
    let window = |id: &str, x: u32, focused: bool| {
        json!({"id": id, "title": id, "app": "App", "pid": 7, "x": x, "y": 120,
               "width": 400, "height": 300, "focused": focused, "elevated": null})
    };
    json!({"windows": [window("101", 100, false), window("202", 600, true)], "ax": {}})
}

pub(crate) fn op_names(harness: &Harness) -> Vec<&'static str> {
    harness
        .sink
        .ops()
        .iter()
        .map(|op| match op {
            SinkOp::QueryFrontWindow => "front",
            SinkOp::Pointer { .. } => "pointer",
            SinkOp::TypeText { .. } => "type",
            SinkOp::KeyChord { .. } => "key",
            SinkOp::RestoreFrontWindow(_) => "restore-front",
            SinkOp::RestoreKeyFocus(_) => "restore-key-focus",
            SinkOp::WarpCursor(_) => "warp",
            SinkOp::ReleaseAll => "release",
            _ => "other",
        })
        .collect()
}

/// A real foreground click into window `101`, run as a transaction's action.
pub(crate) fn foreground_click(worker: &mut Worker) -> CoreResult<()> {
    let event = PointerEvent::Click {
        x: 150.0,
        y: 150.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };
    let target = Target::Window("101".to_owned());
    worker.backend()?.pointer(
        &target,
        event,
        &FrameGeometry::identity_global(),
        DeliveryMode::Foreground,
    )
}

pub(crate) fn foreground_click_mutation() -> Mutation<'static> {
    Mutation::new(MutatingAction::Click, "101".to_owned(), DeliveryMode::Foreground)
}
