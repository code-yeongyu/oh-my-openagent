//! `X11Capture` against the in-memory server,
//! whose root pixel at `(x, y)` is `rgb(x & 0xff, y & 0xff, 0x7f)`.

use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow, DisplaySelector, Target};
use x11rb::protocol::xproto::AtomEnum;

use super::fake::{viewable, FakeServer};
use super::image::RootRect;
use super::X11Capture;

fn root_pixel(x: u8, y: u8) -> [u8; 4] {
    [x, y, 0x7f, 255]
}

fn dual_head() -> FakeServer {
    FakeServer::new(3200, 1080)
        .monitor("DP-1", (0, 0, 1920, 1080), true)
        .monitor("HDMI-1", (1920, 280, 1280, 800), false)
}

#[test]
fn construction_probes_a_one_pixel_root_image() {
    let capture = X11Capture::with_server(FakeServer::new(1280, 800), DisplaySelector::All).unwrap();

    assert_eq!(
        capture.server.requests.borrow().as_slice(),
        [RootRect {
            x: 0,
            y: 0,
            width: 1,
            height: 1
        }]
    );
}

#[test]
fn an_unreadable_root_fails_construction() {
    let result = X11Capture::with_server(FakeServer::new(0, 0), DisplaySelector::All);

    assert_eq!(
        result.err().map(|error| error.code),
        Some(ErrorCode::CaptureFailed)
    );
}

#[test]
fn desktop_capture_composites_each_display_at_its_pixel_origin() {
    let capture = X11Capture::with_server(dual_head(), DisplaySelector::All).unwrap();
    let displays: Vec<DesktopDisplay> = capture.displays().unwrap();

    let (image, frame) = capture.capture(&Target::Desktop).unwrap();

    assert_eq!((image.width(), image.height()), (3200, 1080));
    assert_eq!(image.get_pixel(5, 6).0, root_pixel(5, 6));
    let hdmi_origin = image.get_pixel(1920, 280).0;
    assert_eq!(
        hdmi_origin,
        root_pixel(0x80, 0x18),
        "1920 & 0xff = 0x80, 280 & 0xff = 0x18"
    );
    assert_eq!(
        image.get_pixel(1920, 0).0,
        [0, 0, 0, 0],
        "uncovered composite area stays empty"
    );
    assert_eq!(frame, FrameGeometry::for_displays(&displays));
}

#[test]
fn a_selected_display_is_captured_alone() {
    let capture = X11Capture::with_server(dual_head(), DisplaySelector::Id("HDMI-1".into())).unwrap();

    let (image, _frame) = capture.capture(&Target::Desktop).unwrap();

    assert_eq!((image.width(), image.height()), (1280, 800));
    assert_eq!(image.get_pixel(0, 0).0, root_pixel(0x80, 0x18));
    let listed: Vec<String> = capture.all_displays().unwrap().into_iter().map(|display| display.name).collect();
    assert_eq!(listed, ["DP-1", "HDMI-1"], "a configured display still lists every monitor for per-call targets");
}

#[test]
fn active_capture_requeries_focus_and_per_call_target_does_not_change_default() {
    let server = FakeServer::new(200, 80)
        .monitor("DP-1", (0, 0, 100, 80), true)
        .monitor("HDMI-1", (100, 0, 100, 80), false)
        .root_words("_NET_ACTIVE_WINDOW", AtomEnum::WINDOW, &[77])
        .window(77, viewable(10, 10, 50, 50))
        .window(88, viewable(120, 10, 50, 50));
    let mut capture = X11Capture::with_server(server, DisplaySelector::Active).unwrap();

    let (first, frame) = capture.capture(&Target::Desktop).unwrap();
    assert_eq!(first.dimensions(), (100, 80));
    assert_eq!(frame.map_point(0.0, 0.0, None).unwrap(), (0.0, 0.0));
    let server = std::mem::take(&mut capture.server);
    capture.server = server.root_words("_NET_ACTIVE_WINDOW", AtomEnum::WINDOW, &[88]);
    let (second, frame) = capture.capture(&Target::Desktop).unwrap();
    assert_eq!(second.get_pixel(0, 0).0, root_pixel(100, 0));
    assert_eq!(frame.map_point(0.0, 0.0, None).unwrap(), (100.0, 0.0));

    let (override_image, _) = capture.capture(&Target::parse("display:DP-1")).unwrap();
    assert_eq!(override_image.get_pixel(0, 0).0, root_pixel(0, 0));
    let (again, _) = capture.capture(&Target::Desktop).unwrap();
    assert_eq!(again, second);
    let (all, _) = capture.capture(&Target::parse("display:all")).unwrap();
    assert_eq!(all.dimensions(), (200, 80));
    assert_eq!(capture.capture(&Target::parse("display:missing")).unwrap_err().code, ErrorCode::InvalidTarget);
}

#[test]
fn window_capture_keeps_the_full_frame_and_clears_the_off_root_area() {
    let server = FakeServer::new(1280, 800)
        .root_words("_NET_CLIENT_LIST", AtomEnum::WINDOW, &[77])
        .window(77, viewable(1200, 700, 200, 200));
    let capture = X11Capture::with_server(server, DisplaySelector::All).unwrap();

    let (image, frame) = capture.capture(&Target::Window("77".into())).unwrap();

    assert_eq!((image.width(), image.height()), (200, 200));
    assert_eq!(
        image.get_pixel(0, 0).0,
        root_pixel(0xb0, 0xbc),
        "1200 & 0xff = 0xb0, 700 & 0xff = 0xbc"
    );
    assert_eq!(image.get_pixel(79, 99).0, root_pixel(0xff, 0x1f));
    assert_eq!(image.get_pixel(80, 0).0, [0, 0, 0, 0]);
    assert_eq!(image.get_pixel(0, 100).0, [0, 0, 0, 0]);
    let full = DesktopWindow {
        id: "77".into(),
        title: String::new(),
        app: String::new(),
        pid: None,
        x: 1200,
        y: 700,
        width: 200,
        height: 200,
        focused: false,
        is_on_screen: None,
        elevated: None,
    };
    assert_eq!(frame, FrameGeometry::for_window(&full, 200, 200));
}

#[test]
fn an_unchanged_partially_offscreen_window_keeps_a_targetable_full_frame() {
    let current = DesktopWindow {
        id: "78".into(),
        title: String::new(),
        app: String::new(),
        pid: None,
        x: -20,
        y: -30,
        width: 100,
        height: 100,
        focused: false,
        is_on_screen: None,
        elevated: None,
    };
    let server = FakeServer::new(1280, 800)
        .root_words("_NET_CLIENT_LIST", AtomEnum::WINDOW, &[78])
        .window(78, viewable(-20, -30, 100, 100));
    let capture = X11Capture::with_server(server, DisplaySelector::All).unwrap();

    let (image, frame) = capture.capture(&Target::Window("78".into())).unwrap();

    assert_eq!((image.width(), image.height()), (100, 100));
    assert_eq!(image.get_pixel(0, 0).0, [0, 0, 0, 0]);
    assert_eq!(image.get_pixel(20, 30).0, root_pixel(0, 0));
    assert_eq!(frame.map_point(20.0, 30.0, Some(&current)).unwrap(), (0.0, 0.0));
}

#[test]
fn an_unknown_window_id_is_window_not_found() {
    let capture = X11Capture::with_server(FakeServer::new(1280, 800), DisplaySelector::All).unwrap();

    let error = capture.capture(&Target::Window("404".into())).unwrap_err();

    assert_eq!(error.code, ErrorCode::WindowNotFound);
}
