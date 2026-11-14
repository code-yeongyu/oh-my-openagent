//! What every frames test shares: the two-display fixture, opened sessions, the refusal
//! assertions, the fake's PNG decoded to gray pixels, and a fake shared with the test.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use omo_computer_backend_fake::{
    FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript,
};
use omo_computer_core::backend::{
    Backend, BackendResult, CaptureOptions, Delivered, EpochSource, FrameBytes, PermissionProbe,
    Presence, Route, StopListener, TaggedInput, Target, WindowFilter, WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::listing::Rect;
use omo_computer_core::results::{DisplayInfo, ExecReply};
use serde_json::{json, Value};

use crate::{CapturedFrame, Refused, Session};

const SCENARIO: &str =
    include_str!("../../../../omo-computer-backend-fake/fixtures/two-displays-one-window.json");

/// Window 101's bounds in the fixture.
pub(super) const WINDOW: Rect = Rect {
    x: 100.0,
    y: 120.0,
    width: 800.0,
    height: 600.0,
};

pub(super) fn params<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("params parse")
}

/// The fixture with `extra` members merged in, on a fresh sink.
pub(super) fn fake(extra: &Value) -> (FakeBackend, RecordingSink) {
    let mut scenario: Value = serde_json::from_str(SCENARIO).expect("fixture JSON");
    if let (Some(base), Some(extra)) = (scenario.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            base.insert(key.clone(), value.clone());
        }
    }
    let scenario = FakeScenario::from_json(&scenario.to_string()).expect("scenario");
    let sink = RecordingSink::default();
    let backend = FakeBackend::with_parts(scenario, FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    (backend, sink)
}

/// A session over `backend`, opened with `open` and the stop path armed.
fn opened_with(backend: Box<dyn Backend>, open: Value) -> Session {
    let mut session = Session::new(backend);
    session.open(params(open)).expect("open");
    session.stop_path_start(params(json!({})));
    session
}

/// A null-mode session over `backend`, the stop path armed.
pub(super) fn opened(backend: Box<dyn Backend>) -> Session {
    opened_with(backend, json!({}))
}

/// An object-mode session (the observation model reads refs only there).
pub(super) fn object_session(backend: FakeBackend) -> Session {
    opened_with(Box::new(backend), json!({"reportMode": "object"}))
}

pub(super) fn session(extra: &Value) -> (Session, RecordingSink) {
    let (backend, sink) = fake(extra);
    (opened(Box::new(backend)), sink)
}

pub(super) fn frame(session: &mut Session, target: &str) -> CapturedFrame {
    session.capture_frame(target, true, None).expect("a frame")
}

pub(super) fn click(session: &mut Session, call: Value) -> Result<ExecReply, Refused> {
    session.click(params(call))
}

/// The call is refused `code{reason}` and the sink holds nothing more than before it.
pub(super) fn refused(
    session: &mut Session,
    sink: &RecordingSink,
    call: Value,
    code: &str,
    reason: &str,
) {
    let before = sink.lines();
    let refusal = click(session, call).expect_err("refused").refusal;
    assert_eq!((refusal.code.wire(), refusal.reason), (code, Some(reason)));
    assert_eq!(sink.lines(), before, "a frame refusal sends nothing");
}

pub(super) fn frame_refused(
    session: &mut Session,
    sink: &RecordingSink,
    call: Value,
    reason: &str,
) {
    refused(session, sink, call, "InvalidCoordinateFrame", reason);
}

/// `(width, height, gray pixels)` of the fake's stored-deflate PNG.
fn gray(png: &[u8]) -> (u32, u32, Vec<u8>) {
    let word = |at: usize| u32::from_be_bytes(png[at..at + 4].try_into().expect("4 bytes"));
    let (mut at, mut width, mut height, mut idat) = (8, 0, 0, Vec::new());
    while at + 8 <= png.len() {
        let len = word(at) as usize;
        let data = &png[at + 8..at + 8 + len];
        match &png[at + 4..at + 8] {
            b"IHDR" => (width, height) = (word(at + 8), word(at + 12)),
            b"IDAT" => idat.extend_from_slice(data),
            _ => {}
        }
        at += 12 + len;
    }
    let (mut raw, mut pos) = (Vec::new(), 2);
    loop {
        let last = idat[pos] & 1 == 1;
        let len = usize::from(u16::from_le_bytes([idat[pos + 1], idat[pos + 2]]));
        pos += 5;
        raw.extend_from_slice(&idat[pos..pos + len]);
        pos += len;
        if last {
            break;
        }
    }
    let pixels = raw
        .chunks(width as usize + 1)
        .flat_map(|row| row[1..].to_vec())
        .collect();
    (width, height, pixels)
}

pub(super) fn pixel(frame: &CapturedFrame, x: f64, y: f64) -> u8 {
    let (width, _, pixels) = gray(&frame.bytes.bytes);
    pixels[y as usize * width as usize + x as usize]
}

pub(super) fn count(frame: &CapturedFrame, level: u8) -> usize {
    gray(&frame.bytes.bytes)
        .2
        .iter()
        .filter(|p| **p == level)
        .count()
}

/// Sink lines that move the pointer to `(x, y)`.
pub(super) fn moves_to(sink: &RecordingSink, x: f64, y: f64) -> usize {
    let wanted = format!("pointer_move x={x} y={y}");
    sink.lines()
        .iter()
        .filter(|line| line.ends_with(&wanted))
        .count()
}

/// The fake with its state shared, so a test can move the window after a capture.
#[derive(Clone)]
pub(super) struct Shared(pub(super) Arc<Mutex<FakeBackend>>);

impl Shared {
    pub(super) fn fake(&self) -> MutexGuard<'_, FakeBackend> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Backend for Shared {
    // Row 21 (R70bc): forward the consent view, platform and stop chord to the wrapped fake.
    fn host_consent(&self) -> Option<serde_json::Value> {
        self.fake().host_consent()
    }

    fn platform(&self) -> Option<omo_computer_core::report::Platform> {
        self.fake().platform()
    }

    fn set_stop_chord(&mut self, chord: Option<&str>) -> omo_computer_core::backend::BackendResult<()> {
        self.fake().set_stop_chord(chord)
    }

    fn capabilities(&self) -> Capabilities {
        self.fake().capabilities()
    }

    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.fake().windows(filter)
    }

    fn displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        self.fake().displays()
    }

    fn capture(&mut self, target: &Target, options: &CaptureOptions) -> BackendResult<FrameBytes> {
        self.fake().capture(target, options)
    }

    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        self.fake().post_input(input, route)
    }

    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        self.fake().stop_listener()
    }

    fn probe_permissions(&self) -> PermissionProbe {
        self.fake().probe_permissions()
    }

    fn epoch_source(&mut self) -> Box<dyn EpochSource> {
        self.fake().epoch_source()
    }

    fn presence(&mut self) -> Option<Box<dyn Presence>> {
        self.fake().presence()
    }
}
