//! Frames, the coordinate basis, epochs and displays on the fake: every frame refusal sends
//! nothing, an epoch change supersedes frames and expires refs, `displays()` stays complete,
//! and the default frame carries the pointer while a `crosshair` frame carries the falsifier.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use omo_computer_backend_fake::{
    FakeBackend, FakeClock, FakeScenario, Persona, RecordingSink, StopPathScript, CROSSHAIR_GRAY,
    POINTER_GRAY,
};
use omo_computer_core::backend::{
    Backend, BackendResult, CaptureOptions, Delivered, EpochSource, FrameBytes, PermissionProbe,
    Presence, Route, StopListener, TaggedInput, Target, WindowFilter, WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::frame::EpochReason;
use omo_computer_core::listing::Rect;
use omo_computer_core::observation::CursorMode;
use omo_computer_core::params::Point;
use omo_computer_core::results::{DisplayInfo, ExecReply};
use serde_json::{json, Value};

use crate::{CapturedFrame, EpochChanged, Refused, Session};

const SCENARIO: &str =
    include_str!("../../../omo-computer-backend-fake/fixtures/two-displays-one-window.json");

/// Window 101's bounds in the fixture.
const WINDOW: Rect = Rect {
    x: 100.0,
    y: 120.0,
    width: 800.0,
    height: 600.0,
};

fn params<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("params parse")
}

/// The fixture with `extra` members merged in, on a fresh sink.
fn fake(extra: &Value) -> (FakeBackend, RecordingSink) {
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
fn opened(backend: Box<dyn Backend>) -> Session {
    opened_with(backend, json!({}))
}

/// An object-mode session (the observation model reads refs only there).
fn object_session(backend: FakeBackend) -> Session {
    opened_with(Box::new(backend), json!({"reportMode": "object"}))
}

fn session(extra: &Value) -> (Session, RecordingSink) {
    let (backend, sink) = fake(extra);
    (opened(Box::new(backend)), sink)
}

fn frame(session: &mut Session, target: &str) -> CapturedFrame {
    session.capture_frame(target, true, None).expect("a frame")
}

fn click(session: &mut Session, call: Value) -> Result<ExecReply, Refused> {
    session.click(params(call))
}

/// The call is refused `code{reason}` and the sink holds nothing more than before it.
fn refused(session: &mut Session, sink: &RecordingSink, call: Value, code: &str, reason: &str) {
    let before = sink.lines();
    let refusal = click(session, call).expect_err("refused").refusal;
    assert_eq!((refusal.code.wire(), refusal.reason), (code, Some(reason)));
    assert_eq!(sink.lines(), before, "a frame refusal sends nothing");
}

fn frame_refused(session: &mut Session, sink: &RecordingSink, call: Value, reason: &str) {
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

fn pixel(frame: &CapturedFrame, x: f64, y: f64) -> u8 {
    let (width, _, pixels) = gray(&frame.bytes.bytes);
    pixels[y as usize * width as usize + x as usize]
}

fn count(frame: &CapturedFrame, level: u8) -> usize {
    gray(&frame.bytes.bytes)
        .2
        .iter()
        .filter(|p| **p == level)
        .count()
}

/// Sink lines that move the pointer to `(x, y)`.
fn moves_to(sink: &RecordingSink, x: f64, y: f64) -> usize {
    let wanted = format!("pointer_move x={x} y={y}");
    sink.lines()
        .iter()
        .filter(|line| line.ends_with(&wanted))
        .count()
}

/// The fake with its state shared, so a test can move the window after a capture.
#[derive(Clone)]
struct Shared(Arc<Mutex<FakeBackend>>);

impl Shared {
    fn fake(&self) -> MutexGuard<'_, FakeBackend> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Backend for Shared {
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

#[test]
fn frame_refused_frame_required() {
    let (mut session, sink) = session(&json!({}));
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 10, "y": 10}),
        "frame_required",
    );
    assert!(sink.is_empty());
}

#[test]
fn frame_refused_wrong_target() {
    let (mut session, sink) = session(&json!({}));
    let display = frame(&mut session, "display:1");
    frame(&mut session, "101");
    let call = json!({"target": "101", "x": 10, "y": 10, "frameId": display.frame_id});
    frame_refused(&mut session, &sink, call, "wrong_target");
}

#[test]
fn frame_refused_no_capture() {
    let (mut session, sink) = session(&json!({}));
    frame(&mut session, "101");
    let call = json!({"target": "101", "x": 10, "y": 10, "frameId": "frame-never-issued"});
    frame_refused(&mut session, &sink, call, "no_capture");
}

#[test]
fn frame_refused_superseded() {
    let (mut session, sink) = session(&json!({}));
    let first = frame(&mut session, "101");
    let second = frame(&mut session, "101");
    assert_ne!(
        first.frame_id, second.frame_id,
        "a frame id is never issued twice"
    );
    let call = json!({"target": "101", "x": 10, "y": 10, "frameId": first.frame_id});
    frame_refused(&mut session, &sink, call, "superseded");
    let latest = json!({"target": "101", "x": 10, "y": 10, "frameId": second.frame_id});
    click(&mut session, latest).expect("the latest frame takes input");
}

#[test]
fn frame_refused_consumed() {
    let (mut session, sink) = session(&json!({}));
    let captured = frame(&mut session, "101");
    click(
        &mut session,
        json!({"target": "101", "x": 10, "y": 10, "consume": true}),
    )
    .expect("delivered");
    assert_eq!(sink.len(), 3, "move, down, up: {:?}", sink.lines());
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 10, "y": 10}),
        "consumed",
    );
    let named = json!({"target": "101", "x": 10, "y": 10, "frameId": captured.frame_id});
    frame_refused(&mut session, &sink, named, "consumed");
}

#[test]
fn a_call_without_consume_and_a_refusal_never_consume() {
    let (mut session, sink) = session(&json!({}));
    frame(&mut session, "101");
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 9000, "y": 10, "consume": true}),
        "outside_frame",
    );
    click(&mut session, json!({"target": "101", "x": 10, "y": 10})).expect("delivered");
    click(
        &mut session,
        json!({"target": "101", "x": 10, "y": 10, "consume": true}),
    )
    .expect("still unconsumed");
}

#[test]
fn frame_refused_identity_changed() {
    let changes = json!({"identity_changes": [
        {"after_call": "capture", "window": "101", "new_pid": 5151, "new_processStart": 1_700_000_999}
    ]});
    let (mut session, sink) = session(&changes);
    frame(&mut session, "101");
    refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 10, "y": 10}),
        "WindowNotFound",
        "identity_changed",
    );
}

#[test]
fn frame_refused_resized() {
    let (backend, sink) = fake(&json!({}));
    let shared = Shared(Arc::new(Mutex::new(backend)));
    let mut session = opened(Box::new(shared.clone()));
    frame(&mut session, "101");
    shared
        .fake()
        .set_frame("101", Rect { x: 0.0, ..WINDOW })
        .expect("moved");
    click(&mut session, json!({"target": "101", "x": 10, "y": 10}))
        .expect("a moved window re-anchors");
    assert_eq!(moves_to(&sink, 10.0, 130.0), 1, "{:?}", sink.lines());
    shared
        .fake()
        .set_frame(
            "101",
            Rect {
                width: 640.0,
                ..WINDOW
            },
        )
        .expect("resized");
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 10, "y": 10}),
        "resized",
    );
}

#[test]
fn frame_refused_pixels_only() {
    let (mut session, sink) = session(&json!({"persona": "wayland"}));
    frame(&mut session, "101");
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 10, "y": 10}),
        "pixels_only",
    );
    assert!(sink.is_empty());
}

#[test]
fn frame_refused_outside_frame() {
    let (mut session, sink) = session(&json!({}));
    frame(&mut session, "101");
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 900, "y": 10}),
        "outside_frame",
    );
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": 10, "y": 600}),
        "outside_frame",
    );
    frame_refused(
        &mut session,
        &sink,
        json!({"target": "101", "x": -1, "y": 10}),
        "outside_frame",
    );
    assert!(sink.is_empty());
}

#[test]
fn epoch_changed_expires_frames_and_refs() {
    for reason in EpochReason::ALL {
        let (backend, sink) = fake(&json!({}));
        let mut session = object_session(backend);
        session
            .observe(params(json!({"target": "101"})))
            .expect("observe");
        let token = session.refs.latest("101").expect("a generation").token(0);
        let captured = frame(&mut session, "101");
        session.change_epoch(reason);
        assert_eq!(
            session.take_epoch_events(),
            vec![EpochChanged { reason, epoch: 1 }]
        );
        let stale = session.refs.locate(&token, false).expect_err("expired");
        assert_eq!(
            (stale.code.wire(), stale.reason),
            ("StaleRef", Some("epoch")),
            "{reason:?}"
        );
        let named = json!({"target": "101", "x": 10, "y": 10, "frameId": captured.frame_id});
        frame_refused(&mut session, &sink, named, "superseded");
        frame_refused(
            &mut session,
            &sink,
            json!({"target": "101", "x": 10, "y": 10}),
            "superseded",
        );
        frame(&mut session, "101");
        click(&mut session, json!({"target": "101", "x": 10, "y": 10}))
            .expect("a new frame of the new epoch");
    }
}

#[test]
fn epoch_change_supersedes_frame_and_expires_refs() {
    let events = json!({"epoch_events": [{"after_call": "capture", "reason": "display"}]});
    for persona in [Persona::Macos, Persona::X11, Persona::Win32] {
        let (backend, sink) = fake(&events);
        let mut session = object_session(backend.with_persona(persona));
        session
            .observe(params(json!({"target": "101"})))
            .expect("observe");
        let token = session.refs.latest("101").expect("a generation").token(0);
        frame(&mut session, "101");
        frame_refused(
            &mut session,
            &sink,
            json!({"target": "101", "x": 10, "y": 10}),
            "superseded",
        );
        assert_eq!(
            session.take_epoch_events(),
            vec![EpochChanged {
                reason: EpochReason::Display,
                epoch: 1
            }],
            "{persona:?}"
        );
        let stale = session.refs.locate(&token, false).expect_err("expired");
        assert_eq!(
            (stale.code.wire(), stale.reason),
            ("StaleRef", Some("epoch")),
            "{persona:?}"
        );
    }
}

#[test]
fn displays_complete_after_active_only_capture() {
    let (mut session, sink) = session(&json!({}));
    let active = frame(&mut session, "display:active");
    assert_eq!(active.geometry.regions.len(), 1, "active is one display");
    assert_eq!(
        (active.bytes.width, active.bytes.height),
        (1920, 1080),
        "the focused window's display"
    );
    let ids: Vec<String> = session
        .displays()
        .expect("displays")
        .into_iter()
        .map(|d| d.id)
        .collect();
    assert_eq!(ids, vec!["1".to_owned(), "2".to_owned()]);
    assert!(sink.is_empty());
}

#[test]
fn crosshair_lands_on_requested_point() {
    let (mut session, sink) = session(&json!({}));
    for (target, at) in [
        ("101", Point { x: 37.0, y: 21.0 }),
        (
            "display:2",
            Point {
                x: 2001.0,
                y: 1500.0,
            },
        ),
    ] {
        let plain = session
            .capture_frame(target, false, None)
            .expect("plain frame");
        let crossed = session
            .capture_frame(target, false, Some(at))
            .expect("crosshair frame");
        assert_eq!(pixel(&crossed, at.x, at.y), CROSSHAIR_GRAY, "{target}");
        assert_ne!(pixel(&plain, at.x, at.y), CROSSHAIR_GRAY, "{target}");
        assert_eq!(
            (crossed.geometry.width, crossed.geometry.height),
            (plain.geometry.width, plain.geometry.height),
            "{target}: the crosshair frame keeps the plain frame's coordinate space"
        );
        let mapped = crossed
            .geometry
            .map_point(at.x, at.y, Some(&WINDOW))
            .expect("mapped");
        let back = crossed
            .geometry
            .unmap_point(mapped.0, mapped.1, Some(&WINDOW))
            .expect("unmapped");
        assert_eq!(back, (at.x, at.y), "{target}");
    }
    assert!(
        sink.is_empty(),
        "a capture sends no input: {:?}",
        sink.lines()
    );
}

#[test]
fn default_frame_carries_pointer() {
    // The fixture's own pointer (960,540) is right of window 101 (x 100..900), so the window's
    // frame rightly carries no pointer; this test puts the pointer over the window.
    for persona in [Persona::Macos, Persona::X11, Persona::Win32] {
        let (backend, sink) = fake(&json!({"cursor": {"x": 500, "y": 400}}));
        let mut session = opened(Box::new(backend.with_persona(persona)));
        let shown = frame(&mut session, "101");
        let (x, y) = shown
            .geometry
            .unmap_point(500.0, 400.0, Some(&WINDOW))
            .expect("the pointer is over 101");
        assert_eq!(shown.cursor, CursorMode::Os, "{persona:?}");
        assert_eq!(pixel(&shown, x, y), POINTER_GRAY, "{persona:?}");
        assert_eq!(
            count(&shown, POINTER_GRAY),
            9,
            "{persona:?}: exactly one 3x3 glyph"
        );
        click(&mut session, json!({"target": "101", "x": x, "y": y})).expect("delivered");
        let hidden = session
            .capture_frame("101", false, None)
            .expect("pointer-free frame");
        assert_eq!(hidden.cursor, CursorMode::None, "{persona:?}");
        assert_eq!(count(&hidden, POINTER_GRAY), 0, "{persona:?}");
        assert_eq!(
            (hidden.geometry.width, hidden.geometry.height),
            (shown.geometry.width, shown.geometry.height)
        );
        click(&mut session, json!({"target": "101", "x": x, "y": y})).expect("delivered");
        assert_eq!(
            moves_to(&sink, 500.0, 400.0),
            2,
            "{persona:?}: {:?}",
            sink.lines()
        );
    }
}

/// An artifact frame lands only under the session's own STATE root: two sessions over two
/// roots never share an artifact dir, and a session with no root writes nowhere shared (it
/// refuses the artifact instead of falling back to a fixed temp path).
#[test]
fn artifact_frames_never_leave_the_sessions_own_root() {
    let over_budget = json!({"target": "101", "caps": {"maxBytes": 1}, "cursor": false});
    let mut paths = Vec::new();
    let roots: Vec<tempfile::TempDir> = (0..2)
        .map(|_| tempfile::tempdir().expect("tempdir"))
        .collect();
    for root in &roots {
        let (backend, _) = fake(&json!({}));
        let own = omo_computer_core::paths::Roots {
            state: root.path().to_owned(),
            runtime: root.path().to_owned(),
        };
        let mut session = Session::for_roots(Box::new(backend), &own);
        session.open(params(json!({}))).expect("open");
        let reply = serde_json::to_value(
            session
                .capture(params(over_budget.clone()))
                .expect("artifact frame"),
        )
        .expect("reply JSON");
        let path =
            std::path::PathBuf::from(reply["artifactPath"].as_str().expect("an artifact path"));
        assert!(
            path.starts_with(root.path()),
            "{} is outside {}",
            path.display(),
            root.path().display()
        );
        assert!(path.exists());
        paths.push(path);
    }
    assert_ne!(
        paths[0].parent(),
        paths[1].parent(),
        "two sessions share an artifact dir"
    );

    let (backend, sink) = fake(&json!({}));
    let mut rootless = Session::new(Box::new(backend));
    rootless.open(params(json!({}))).expect("open");
    let refusal = rootless
        .capture(params(over_budget))
        .expect_err("no root: nowhere to write");
    assert_eq!(refusal.code.wire(), "CaptureFailed");
    assert!(sink.is_empty());
}
