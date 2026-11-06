use image::RgbaImage;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopDisplay, DisplaySelector};

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

#[test]
fn active_uses_primary_without_focused_geometry_and_all_keeps_composite() {
    let display = |id: &str, x, primary| DesktopDisplay {
        id: id.into(), name: id.into(), x, y: 0, width: 2, height: 2,
        scale: 1.0, pixel_x: u32::try_from(x).unwrap(), pixel_y: 0, pixel_width: 2,
        pixel_height: 2, is_primary: primary,
    };
    let displays = vec![display("left", 0, false), display("primary", 2, true)];
    let image = RgbaImage::from_pixel(4, 2, [2, 3, 4, 255].into());

    let (active, selected) = select_capture(&DisplaySelector::Active, image.clone(), displays.clone()).unwrap();
    assert_eq!(active.dimensions(), (2, 2));
    assert_eq!(selected[0].id, "primary");
    assert_eq!(FrameGeometry::for_displays(&selected).map_point(0.0, 0.0, None).unwrap(), (2.0, 0.0));
    let (all, selected) = select_capture(&DisplaySelector::All, image.clone(), displays.clone()).unwrap();
    assert_eq!(all.dimensions(), (4, 2));
    assert_eq!(selected.len(), 2);
    let error = select_capture(&DisplaySelector::Id("missing".into()), image, displays).unwrap_err();
    assert_eq!(error.code, senpi_desktop_core::error::ErrorCode::InvalidTarget);
}
