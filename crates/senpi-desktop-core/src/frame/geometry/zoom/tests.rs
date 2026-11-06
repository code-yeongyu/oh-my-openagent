use image::{Rgba, RgbaImage};

use crate::error::ErrorCode;
use crate::frame::{apply_capture_caps, FrameGeometry};
use crate::types::{CaptureCaps, CaptureRegion, DesktopWindow};

fn window(width: u32, x: i32) -> DesktopWindow {
    DesktopWindow {
        id: "101".into(),
        title: String::new(),
        app: String::new(),
        pid: None,
        x,
        y: 0,
        width,
        height: 48,
        focused: true,
        is_on_screen: None,
        elevated: None,
    }
}

#[test]
fn zoom_maps_fractional_regions_to_fresh_native_pixels() {
    // Given
    let fresh = FrameGeometry::for_window(&window(64, 0), 128, 96);
    let mut base = fresh.clone();
    let image = RgbaImage::from_pixel(128, 96, Rgba([8, 9, 10, 255]));
    apply_capture_caps(
        image.clone(),
        &mut base,
        &CaptureCaps {
            max_width: Some(32),
            ..CaptureCaps::default()
        },
    )
    .unwrap();
    let region = CaptureRegion {
        x: 8.125,
        y: 6.125,
        width: 0.25,
        height: 0.25,
    };
    // When
    let crop = base.crop_region(image, &fresh, &region).unwrap();
    // Then
    assert_eq!(crop.dimensions(), (2, 2));
    assert_eq!(base.dimensions(), (32, 24));
}

#[test]
fn zoom_refuses_incompatible_fresh_geometry_and_image_dimensions() {
    // Given
    let base = FrameGeometry::for_window(&window(64, 0), 128, 96);
    let region = CaptureRegion {
        x: 0.0,
        y: 0.0,
        width: 8.0,
        height: 6.0,
    };
    // When
    let resized = base.crop_region(
        RgbaImage::new(128, 96),
        &FrameGeometry::for_window(&window(65, 0), 128, 96),
        &region,
    );
    let mismatch = base.crop_region(RgbaImage::new(64, 48), &base, &region);
    // Then
    assert_eq!(resized.unwrap_err().code, ErrorCode::InvalidCoordinateFrame);
    assert_eq!(
        mismatch.unwrap_err().code,
        ErrorCode::InvalidCoordinateFrame
    );
}

#[test]
fn zoom_allows_window_movement_without_reanchoring_the_stored_frame() {
    // Given
    let base = FrameGeometry::for_window(&window(64, 0), 128, 96);
    let fresh = FrameGeometry::for_window(&window(64, 100), 128, 96);
    let region = CaptureRegion {
        x: 0.0,
        y: 0.0,
        width: 8.0,
        height: 6.0,
    };
    // When
    let crop = base
        .crop_region(RgbaImage::new(128, 96), &fresh, &region)
        .unwrap();
    // Then
    assert_eq!(crop.dimensions(), (8, 6));
    assert_eq!(
        base.map_point(0.0, 0.0, Some(&window(64, 100))).unwrap(),
        (100.0, 0.0)
    );
}
