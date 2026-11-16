use image::{Rgba, RgbaImage};
use omo_computer_core::backend::{CaptureOptions, Refusal, Target};
use omo_computer_core::capabilities::CaptureRoute;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::listing::Rect;
use omo_computer_core::observation::CursorMode;
use omo_computer_core::params::Point;

use super::damage_wait::{DamageWait, DamageWatch};
use super::fake::{FakeX, GREEN, MAGENTA, RED};
use super::server::PixelRect;
use super::X11Capture;

const WINDOW: PixelRect = PixelRect {
    x: 40,
    y: 30,
    width: 120,
    height: 80,
};

fn options(cursor: bool) -> CaptureOptions {
    CaptureOptions {
        cursor,
        crosshair: None,
        region: None,
    }
}

fn count(image: &RgbaImage, colour: Rgba<u8>) -> usize {
    image.pixels().filter(|pixel| **pixel == colour).count()
}

fn occluded() -> FakeX {
    FakeX::single(320, 200)
        .with_window(7, WINDOW, GREEN)
        .with_occluder(PixelRect {
            x: 60,
            y: 40,
            width: 60,
            height: 50,
        })
}

#[test]
fn window_capture_survives_an_occluder() {
    let server = occluded();
    assert!(count(&server.root, MAGENTA) > 1_000, "the screen under the occluder shows it");
    let capture = X11Capture::new(server, None);
    let frame = capture.capture_frame(&Target::Window("7".into()), &options(false)).expect("frame");
    assert_eq!(count(&frame.image, MAGENTA), 0);
    assert_eq!(count(&frame.image, GREEN), 120 * 80);
    assert_eq!(frame.route, CaptureRoute::Composite);
    assert!(!frame.occluders_visible);
}

#[test]
fn without_a_compositing_manager_the_target_is_redirected_for_the_read() {
    let mut server = occluded();
    server.compositor = false;
    let capture = X11Capture::new(server, None);
    let frame = capture.capture_frame(&Target::Window("0x7".into()), &options(false)).expect("frame");
    assert_eq!(count(&frame.image, MAGENTA), 0);
    assert_eq!(frame.route, CaptureRoute::Composite);
    assert_eq!(capture.server().redirects.get(), 1);
}

#[test]
fn under_a_compositing_manager_the_target_is_still_redirected_for_the_read() {
    let server = occluded();
    assert!(server.compositor);
    let capture = X11Capture::new(server, None);
    let frame = capture.capture_frame(&Target::Window("7".into()), &options(false)).expect("frame");
    assert_eq!(frame.route, CaptureRoute::Composite);
    assert_eq!(count(&frame.image, GREEN), 120 * 80);
    assert_eq!(capture.server().redirects.get(), 1);
}

#[test]
fn a_redirected_window_that_never_repaints_is_an_annotated_root_crop() {
    let mut server = occluded();
    server.repaints = false;
    let capture = X11Capture::new(server, None);
    let frame = capture.capture_frame(&Target::Window("7".into()), &options(false)).expect("frame");
    assert_eq!(frame.route, CaptureRoute::RootCrop);
    assert!(frame.occluders_visible, "stale pixels never pass as a clean Composite frame");
    assert!(count(&frame.image, MAGENTA) > 0);
}

#[test]
fn refused_redirect_is_an_annotated_root_crop() {
    let mut server = occluded();
    server.compositor = false;
    server.composite_extension = false;
    let capture = X11Capture::new(server, None);
    let frame = capture.capture_frame(&Target::Window("7".into()), &options(false)).expect("frame");
    assert_eq!(frame.route, CaptureRoute::RootCrop);
    assert!(frame.occluders_visible);
    assert!(count(&frame.image, MAGENTA) > 0);
    assert_eq!((frame.image.width(), frame.image.height()), (120, 80));
}

#[test]
fn minimized_and_unmapped_windows_refuse_typed() {
    let mut server = occluded();
    server.windows[0].minimized = true;
    let capture = X11Capture::new(server, None);
    let refusal = capture.capture_frame(&Target::Window("7".into()), &options(false)).unwrap_err();
    assert_eq!(refusal, Refusal::new(EngineCode::CaptureUnavailable, Reason::Minimized));
    let mut server = occluded();
    server.windows[0].viewable = false;
    let capture = X11Capture::new(server, None);
    let refusal = capture.capture_frame(&Target::Window("7".into()), &options(false)).unwrap_err();
    assert_eq!(refusal, Refusal::new(EngineCode::CaptureUnavailable, Reason::Unmapped));
    let refusal = capture.capture_frame(&Target::Window("99".into()), &options(false)).unwrap_err();
    assert_eq!(refusal, Refusal::bare(EngineCode::WindowNotFound));
}

#[test]
fn cursor_is_composited_in_device_pixels() {
    let server = FakeX::single(200, 100).with_resources("Xft.dpi: 192\n").with_cursor(50, 40, 1, 3);
    let capture = X11Capture::new(server, None);
    let frame = capture.capture_frame(&Target::Desktop, &options(true)).expect("frame");
    assert_eq!((frame.image.width(), frame.image.height()), (200, 100));
    assert_eq!(frame.cursor, CursorMode::Engine);
    assert_eq!(*frame.image.get_pixel(49, 39), RED);
    assert_eq!(*frame.image.get_pixel(51, 41), RED);
    assert_eq!(count(&frame.image, RED), 9);
    assert_ne!(*frame.image.get_pixel(99, 79), RED, "never at the scaled coordinate");
    let bare = capture.capture_frame(&Target::Desktop, &options(false)).expect("frame");
    assert_eq!(count(&bare.image, RED), 0);
    assert_eq!(bare.cursor, CursorMode::None);
}

#[test]
fn window_frame_carries_the_pointer_only_inside_its_rect() {
    let inside = occluded().with_cursor(50, 40, 0, 2);
    let capture = X11Capture::new(inside, None);
    let frame = capture.capture_frame(&Target::Window("7".into()), &options(true)).expect("frame");
    assert_eq!(*frame.image.get_pixel(10, 10), RED);
    assert_eq!(frame.cursor, CursorMode::Engine);
    let outside = occluded().with_cursor(5, 5, 0, 2);
    let capture = X11Capture::new(outside, None);
    let frame = capture.capture_frame(&Target::Window("7".into()), &options(true)).expect("frame");
    assert_eq!(count(&frame.image, RED), 0);
    assert_eq!(frame.cursor, CursorMode::None);
}

#[test]
fn display_target_composites_one_monitor_and_region_crops_in_logical_points() {
    let capture = X11Capture::new(FakeX::two_screens(), None);
    let frame = capture.capture_frame(&Target::Display("HDMI-1".into()), &options(false)).expect("frame");
    assert_eq!((frame.image.width(), frame.image.height()), (1024, 768));
    let mut region = options(false);
    region.region = Some(Rect {
        x: 1300.0,
        y: 10.0,
        width: 100.0,
        height: 50.0,
    });
    let cropped = capture.capture_frame(&Target::Desktop, &region).expect("frame");
    assert_eq!((cropped.image.width(), cropped.image.height()), (100, 50));
    let unknown = capture.capture_frame(&Target::Display("VGA-9".into()), &options(false));
    assert_eq!(unknown.unwrap_err(), Refusal::bare(EngineCode::InvalidTarget));
}

#[test]
fn crosshair_is_drawn_at_the_frame_point() {
    let capture = X11Capture::new(FakeX::single(100, 100), None);
    let mut with = options(false);
    with.crosshair = Some(Point { x: 50.0, y: 50.0 });
    let frame = capture.capture_frame(&Target::Desktop, &with).expect("frame");
    let gray = Rgba([0x80, 0x80, 0x80, 0xFF]);
    assert_eq!(*frame.image.get_pixel(50, 42), gray);
    assert_eq!(*frame.image.get_pixel(58, 50), gray);
}

/// The sequence number the fake `ClearArea` request carries in the scripts below.
const CLEAR: u16 = 0x0412;

fn repainted_after(clear: u16, notifies: &[u16]) -> Vec<DamageWait> {
    let watch = DamageWatch::new(clear);
    notifies.iter().map(|sequence| watch.after_notify(*sequence)).collect()
}

#[test]
fn a_background_none_window_is_repainted_on_its_first_notify() {
    // review L4 case 1: the server paints no background for None, so the first notify the
    // capture sees comes after the ClearArea, from the client's own repaint.
    assert_eq!(repainted_after(CLEAR, &[CLEAR + 1]), [DamageWait::Repainted]);
}

#[test]
fn the_server_paint_alone_is_never_a_repaint_however_many_rectangles_it_reports() {
    // Raw rectangles: one ClearArea paint may report several notifies, all inside the request.
    let steps = repainted_after(CLEAR, &[CLEAR, CLEAR, CLEAR]);
    assert!(steps.iter().all(|step| *step != DamageWait::Repainted), "{steps:?}");
}

#[test]
fn a_repaint_right_after_the_server_paint_is_seen() {
    // review L4 case 2: the client repaints on Expose before the capture could subtract; the
    // repaint is its own notify after the ClearArea, never merged into the server's paint.
    let steps = repainted_after(CLEAR, &[CLEAR, CLEAR + 1]);
    assert_eq!(steps.last(), Some(&DamageWait::Repainted), "{steps:?}");
    assert_ne!(steps[0], DamageWait::Repainted);
}

#[test]
fn the_server_background_paint_is_not_the_client_repainting() {
    assert_eq!(repainted_after(CLEAR, &[CLEAR]), [DamageWait::ServerPaint], "ClearArea's own background paint");
}

#[test]
fn the_sequence_comparison_survives_the_16_bit_wrap() {
    assert_eq!(repainted_after(u16::MAX, &[u16::MAX, 0]).last(), Some(&DamageWait::Repainted));
    assert_eq!(repainted_after(u16::MAX, &[0]), [DamageWait::Repainted]);
}
