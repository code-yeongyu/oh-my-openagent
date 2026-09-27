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
        id: "7".into(),
        title: "T".into(),
        app: "A".into(),
        pid: None,
        x,
        y,
        width: 400,
        height: 300,
        focused: false,
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
