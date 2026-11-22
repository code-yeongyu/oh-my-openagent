use image::{Rgba, RgbaImage};
use proptest::prelude::*;

use super::*;
use crate::error::ErrorCode;
use crate::types::{CaptureCaps, DesktopDisplay, DesktopWindow};

fn display_at(x: i32, pixel_x: u32, scale: f64) -> DesktopDisplay {
    DesktopDisplay {
        id: "1".into(),
        name: "test".into(),
        x,
        y: 50,
        width: 400,
        height: 300,
        scale,
        pixel_x,
        pixel_y: 0,
        pixel_width: (400.0 * scale) as u32,
        pixel_height: (300.0 * scale) as u32,
        is_primary: true,
    }
}
fn display(scale: f64) -> DesktopDisplay {
    display_at(100, 0, scale)
}
fn window(x: i32, y: i32) -> DesktopWindow {
    DesktopWindow {
        identity: None,
        id: "7".into(),
        title: "T".into(),
        app: "A".into(),
        pid: None,
        x,
        y,
        width: 400,
        height: 300,
        focused: false,
        is_on_screen: None,
        elevated: None,
    }
}

#[test]
fn pixel_to_logical_at_one_and_two_x() {
    for scale in [1.0, 2.0] {
        let f = FrameGeometry::for_displays(&[display(scale)]);
        assert_eq!(
            f.map_point(200.0 * scale, 100.0 * scale, None).unwrap(),
            (300.0, 150.0)
        );
    }
}
#[test]
fn moved_window_is_reanchored() {
    let f = FrameGeometry::for_window(&window(10, 20), 800, 600);
    assert_eq!(
        f.map_point(400.0, 300.0, Some(&window(110, 220))).unwrap(),
        (310.0, 370.0)
    );
}
#[test]
fn cap_scaling_adjusts_geometry() {
    let mut f = FrameGeometry::for_displays(&[display(2.0)]);
    let image = RgbaImage::from_pixel(800, 600, Rgba([0, 0, 0, 255]));
    let caps = CaptureCaps {
        max_width: Some(400),
        max_height: Some(400),
        ..CaptureCaps::default()
    };
    let image = apply_capture_caps(image, &mut f, &caps).unwrap();
    assert_eq!((image.width(), image.height()), (400, 300));
    assert_eq!(f.map_point(200.0, 100.0, None).unwrap(), (300.0, 150.0));
}

#[test]
fn uncapped_composite_over_max_composite_pixels_is_capture_failed() {
    // Given: a 20000x20000 frame (4e8 px > MAX_COMPOSITE_PIXELS); the zeroed
    // buffer is lazily mapped, so no pixel is touched before the size check.
    let image = RgbaImage::new(20_000, 20_000);
    let mut geometry = FrameGeometry::identity_global();
    // When: no caps shrink it.
    let error = apply_capture_caps(image, &mut geometry, &CaptureCaps::default()).unwrap_err();
    // Then
    assert_eq!(error.code, ErrorCode::CaptureFailed);
}

proptest! {
    #[test]
    fn map_point_round_trips_map_to_pixel_within_half_pixel(
        left in 1.0f64..=3.0,
        right in 1.0f64..=3.0,
        x in 0.0f64..799.0,
        y in 50.0f64..349.0,
    ) {
        // Given: two side-by-side displays with independent random scales.
        let first = display_at(0, 0, left);
        let second = display_at(400, first.pixel_width, right);
        let frame = FrameGeometry::for_displays(&[first, second]);
        // When: a logical point goes to capture pixels and back.
        let (px, py) = frame.map_to_pixel(x, y).unwrap();
        let (lx, ly) = frame.map_point(px, py, None).unwrap();
        // Then
        prop_assert!((lx - x).abs() <= 0.5 && (ly - y).abs() <= 0.5, "({x}, {y}) -> ({lx}, {ly})");
    }
}

#[test]
fn pixels_only_frame_refuses_coordinate_input_and_hit_tests() {
    // Given: a 1280x720 capture from a source that reports no logical geometry.
    let frame = FrameGeometry::pixels_only(1280, 720, "no geometry");
    // Then: an in-bounds pixel is refused, naming the reason, both ways.
    let error = frame.map_point(640.0, 360.0, None).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidCoordinateFrame);
    assert!(error.message.contains("no geometry"), "{}", error.message);
    assert_eq!(
        frame.map_to_pixel(10.0, 10.0).unwrap_err().code,
        ErrorCode::InvalidCoordinateFrame
    );
    // An out-of-frame pixel keeps the ordinary bounds error.
    assert!(frame.map_point(5000.0, 1.0, None).unwrap_err().message.contains("outside the last capture frame"));
}

#[test]
fn a_window_frame_keeps_its_owner_follows_a_move_and_names_a_resize() {
    // Given
    let identity = crate::types::WindowIdentity {
        window_number: "7".into(),
        pid: 42,
        process_start: Some(1_700_000_000),
    };
    let captured = DesktopWindow {
        identity: Some(identity.clone()),
        ..window(100, 50)
    };
    let frame = FrameGeometry::for_window(&captured, captured.width, captured.height);
    let moved = window(300, 80);
    let resized = DesktopWindow {
        width: captured.width + 1,
        ..moved.clone()
    };
    // When
    let mapped = frame.map_point(10.0, 10.0, Some(&moved)).unwrap();
    let refused = frame.map_point(10.0, 10.0, Some(&resized)).unwrap_err();
    let outside = frame.map_point(-1.0, 10.0, Some(&moved)).unwrap_err();
    // Then
    assert_eq!(frame.identity(), Some(&identity));
    assert_eq!(mapped, (310.0, 90.0));
    let reason = |error: crate::error::DesktopError| error.report.and_then(|report| report.reason);
    assert_eq!(refused.code, ErrorCode::InvalidCoordinateFrame);
    assert_eq!(reason(refused).as_deref(), Some("resized"));
    assert_eq!(reason(outside).as_deref(), Some("out_of_bounds"));
    assert!(frame.check_size(&moved).is_ok());
    assert!(frame.check_size(&resized).is_err());
}
