//! What a capture shows and where it lands: `displays()` stays complete, the crosshair and
//! the pointer are drawn where they belong, and artifact frames stay under the session's root.

use omo_computer_backend_fake::{FakeBackend, Persona, CROSSHAIR_GRAY, POINTER_GRAY};
use omo_computer_core::backend::{
    Backend, BackendResult, CaptureOptions, Delivered, EpochSource, FrameBytes, PermissionProbe,
    Presence, Route, StopListener, TaggedInput, Target, WindowFilter, WindowList,
};
use omo_computer_core::capabilities::{Capabilities, CaptureRoute};
use omo_computer_core::observation::CursorMode;
use omo_computer_core::params::Point;
use omo_computer_core::results::DisplayInfo;
use serde_json::json;

use super::helpers::{click, count, fake, frame, moves_to, opened, params, pixel, session, WINDOW};
use crate::Session;

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

/// A wrapper that stamps the capture annotations row 47's backends report onto the fake's
/// frames, so the session's read of them is proven without the fake growing behaviour it
/// must not have (the fake reports no annotations).
struct Annotated(FakeBackend);

impl Backend for Annotated {
    fn capabilities(&self) -> Capabilities {
        self.0.capabilities()
    }
    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.0.windows(filter)
    }
    fn displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        self.0.displays()
    }
    fn capture(&mut self, target: &Target, options: &CaptureOptions) -> BackendResult<FrameBytes> {
        let mut bytes = self.0.capture(target, options)?;
        bytes.route = Some(CaptureRoute::Composite);
        bytes.occluders_visible = Some(false);
        bytes.cursor = Some(CursorMode::Engine);
        Ok(bytes)
    }
    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        self.0.post_input(input, route)
    }
    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        self.0.stop_listener()
    }
    fn probe_permissions(&self) -> PermissionProbe {
        self.0.probe_permissions()
    }
    fn epoch_source(&mut self) -> Box<dyn EpochSource> {
        self.0.epoch_source()
    }
    fn presence(&mut self) -> Option<Box<dyn Presence>> {
        self.0.presence()
    }
}

#[test]
fn backend_capture_annotations_are_read_into_the_frame() {
    let (backend, sink) = fake(&json!({}));
    let mut session = Session::new(Box::new(Annotated(backend)));
    session.open(params(json!({}))).expect("open");
    session.stop_path_start(params(json!({})));
    let captured = session.capture_frame("101", false, None).expect("a frame");
    assert_eq!(captured.route, Some(CaptureRoute::Composite));
    assert_eq!(captured.occluders_visible, Some(false));
    assert_eq!(captured.cursor, CursorMode::Engine, "the backend's own report wins over the call flag");
    assert!(sink.is_empty(), "a read sends nothing");
}
