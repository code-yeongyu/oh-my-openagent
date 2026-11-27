use omo_computer_core::observation::CursorMode;

use super::*;
use crate::capture::fake::{FakeX, GREEN};
use crate::capture::server::PixelRect;

fn options() -> CaptureOptions {
    CaptureOptions {
        cursor: true,
        crosshair: None,
        region: None,
    }
}

#[test]
fn no_display_refuses_capture_and_displays_with_nothing_sent() {
    let mut backend = X11Backend::from_env(None, None);
    assert_eq!(backend.display_server(), "none");
    let ruled = Refusal::new(EngineCode::Internal, Reason::NoDisplayServer);
    assert_eq!(
        backend.capture(&Target::Desktop, &options()).unwrap_err(),
        ruled
    );
    assert_eq!(backend.displays().unwrap_err(), ruled);
    assert_eq!(
        backend.windows(&WindowFilter::default()).unwrap_err(),
        ruled
    );
    let input = TaggedInput {
        event: omo_computer_core::backend::InputEvent::Text("x".into()),
        tag: 1,
    };
    assert_eq!(
        backend
            .post_input(&input, Route::ForegroundHid)
            .unwrap_err(),
        ruled
    );
    let mut empty = X11Backend::from_env(Some(""), None);
    assert_eq!(empty.display_server(), "none");
    assert_eq!(
        empty.capture(&Target::Desktop, &options()).unwrap_err(),
        ruled
    );
}

#[test]
fn capabilities_report_the_display_server_state() {
    let none = X11Backend::from_env(None, None).capabilities();
    assert_eq!(none.backend, "x11");
    assert!(!none.capture.available);
    assert_eq!(none.capture.reason.as_deref(), Some("no_display_server"));
    let mut server = FakeX::two_screens();
    server.composite_extension = false;
    let live = X11Backend::with_capture(Some(X11Capture::new(server, None))).capabilities();
    assert!(live.capture.available && live.window_capture.available);
    assert_eq!(live.capture.route, Some(CaptureRoute::RootCrop));
    assert_eq!(live.display_count, 2);
}

#[test]
fn capture_returns_png_with_its_annotations() {
    let server = FakeX::single(160, 120).with_window(
        9,
        PixelRect {
            x: 10,
            y: 10,
            width: 50,
            height: 40,
        },
        GREEN,
    );
    let mut backend = X11Backend::with_capture(Some(X11Capture::new(server, None)));
    let frame = backend
        .capture(&Target::Window("9".into()), &options())
        .expect("frame");
    assert_eq!((frame.width, frame.height), (50, 40));
    assert_eq!(frame.mime, ImageMime::Png);
    assert!(frame.bytes.starts_with(b"\x89PNG"));
    assert_eq!(frame.route, Some(CaptureRoute::Composite));
    assert_eq!(frame.occluders_visible, Some(false));
    assert_eq!(frame.cursor, Some(CursorMode::None));
}

#[test]
fn post_input_reaches_xtest_and_apps_open_reaches_the_resolver() {
    use std::collections::BTreeSet;

    use omo_computer_backend_atspi::fake::FakeBus;
    use omo_computer_backend_atspi::AtspiBackend;

    use crate::input::fake::FakeServer;
    use crate::input::keys::{keysym, GroupMap};
    use crate::input::server::{FakeInput, InputServer};
    use crate::input::{InputSettings, X11Input};

    let x = keysym("x").expect("keysym");
    let server = FakeServer::with(GroupMap::new(9, vec![vec![[x, 0]]], &BTreeSet::new()), 0);
    let input = X11Input::new(
        Box::new(server.clone()) as Box<dyn InputServer>,
        InputSettings::default(),
    );
    let mut backend = X11Backend::with_capture(Some(X11Capture::new(FakeX::single(8, 8), None)))
        .with_input(input);
    let typed = TaggedInput {
        event: omo_computer_core::backend::InputEvent::Text("x".into()),
        tag: 1,
    };
    assert_eq!(
        backend.post_input(&typed, Route::ForegroundHid),
        Ok(Delivered { count: 1, of: 1 })
    );
    assert_eq!(
        server.fakes(),
        [
            FakeInput::Key {
                code: 9,
                press: true
            },
            FakeInput::Key {
                code: 9,
                press: false
            }
        ]
    );
    let launch = TaggedInput {
        event: omo_computer_core::backend::InputEvent::AppLaunch {
            app_key: "missing.desktop".into(),
            activate: false,
        },
        tag: 2,
    };
    let unsupported = Refusal::new(EngineCode::Internal, Reason::InputUnsupported);
    assert_eq!(
        backend.post_input(&launch, Route::BackgroundPid),
        Err(unsupported),
        "no resolver attached"
    );
    let (bus, _handle) = FakeBus::new();
    let mut backend =
        backend.with_apps(Box::new(AtspiBackend::new(Some(bus), Box::new(Vec::new()))));
    assert_eq!(
        backend.post_input(&launch, Route::BackgroundPid),
        Err(Refusal::new(EngineCode::InvalidTarget, Reason::AppUnknown)),
        "the resolver's own refusal, nothing launched"
    );
}
