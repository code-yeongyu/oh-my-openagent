use image::RgbaImage;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::DisplaySelector;

use super::screencast::MonitorStream;
use super::{composite, select_capture, DISPLAY_PREFIX};

#[test]
fn selected_screencast_display_returns_only_that_monitor() {
    // Given: two logical neighbors whose streams use different scales
    let left = MonitorStream {
        node: 1,
        position: (0, 0),
        size: Some((2, 2)),
    };
    let right = MonitorStream {
        node: 2,
        position: (2, 0),
        size: Some((2, 1)),
    };
    let cast = composite(
        &[
            (left, RgbaImage::from_pixel(2, 2, [1, 1, 1, 255].into())),
            (right, RgbaImage::from_pixel(4, 2, [2, 2, 2, 255].into())),
        ],
        None,
    );
    let (image, displays) = (cast.image, cast.displays);

    // When
    let (selected, displays) = select_capture(
        &DisplaySelector::Id(format!("{DISPLAY_PREFIX}1")),
        image,
        displays,
    )
    .expect("selected display");

    // Then: capture pixels start at zero while logical coordinates remain global
    assert_eq!(selected.dimensions(), (4, 2));
    assert_eq!(displays.len(), 1);
    let display = &displays[0];
    assert_eq!(display.id, format!("{DISPLAY_PREFIX}1"));
    assert_eq!((display.x, display.y), (2, 0));
    assert_eq!((display.pixel_x, display.pixel_y), (0, 0));
    assert_eq!(
        FrameGeometry::for_displays(&displays).map_point(0.0, 0.0, None),
        Ok((2.0, 0.0))
    );
}
