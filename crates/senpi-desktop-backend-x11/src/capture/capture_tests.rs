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
}

#[test]
fn window_capture_clips_to_the_root_and_frames_the_clipped_bounds() {
    let server = FakeServer::new(1280, 800)
        .root_words("_NET_CLIENT_LIST", AtomEnum::WINDOW, &[77])
        .window(77, viewable(1200, 700, 200, 200));
    let capture = X11Capture::with_server(server, DisplaySelector::All).unwrap();

    let (image, frame) = capture.capture(&Target::Window("77".into())).unwrap();

    assert_eq!((image.width(), image.height()), (80, 100));
    assert_eq!(
        image.get_pixel(0, 0).0,
        root_pixel(0xb0, 0xbc),
        "1200 & 0xff = 0xb0, 700 & 0xff = 0xbc"
    );
    let clipped = DesktopWindow {
        id: "77".into(),
        title: String::new(),
        app: String::new(),
        pid: None,
        x: 1200,
        y: 700,
        width: 80,
        height: 100,
        focused: false,
        elevated: None,
    };
    assert_eq!(frame, FrameGeometry::for_window(&clipped, 80, 100));
}

#[test]
fn an_unknown_window_id_is_window_not_found() {
    let capture = X11Capture::with_server(FakeServer::new(1280, 800), DisplaySelector::All).unwrap();

    let error = capture.capture(&Target::Window("404".into())).unwrap_err();

    assert_eq!(error.code, ErrorCode::WindowNotFound);
}
