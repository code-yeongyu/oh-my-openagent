//! Display-free geometry tests over synthetic monitor samples.

use image::{Rgba, RgbaImage};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopDisplay, DisplaySelector};

use super::frame::{
    capture_geometry_matches, composite, lay_out, logical_bounds, logical_window_rect, physical_point,
    MonitorSample, PhysicalRect,
};

fn monitor(id: &str, (x, y): (i32, i32), (width, height): (u32, u32), scale: f64) -> ((), MonitorSample) {
    let sample = MonitorSample {
        id: id.to_string(),
        name: format!("Display {id}"),
        x,
        y,
        width,
        height,
        scale,
        is_primary: (x, y) == (0, 0),
    };
    ((), sample)
}

fn displays(samples: Vec<((), MonitorSample)>) -> Vec<DesktopDisplay> {
    lay_out(samples, &DisplaySelector::All)
        .unwrap()
        .into_iter()
        .map(|((), display)| display)
        .collect()
}

#[test]
fn monitor_at_150_percent_reports_logical_size_and_physical_pixels() {
    let [display] = displays(vec![monitor("1", (0, 0), (2880, 1620), 1.5)])
        .try_into()
        .unwrap();
    assert_eq!((display.width, display.height), (2880, 1620));
    assert_eq!((display.pixel_width, display.pixel_height), (2880, 1620));
}

#[test]
fn unknown_display_id_is_an_invalid_target() {
    let error = lay_out(
        vec![monitor("65537", (0, 0), (1920, 1080), 1.0)],
        &DisplaySelector::Id("999".into()),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidTarget);
    assert_eq!(error.message, "selected display id '999' is not active");
}

#[test]
fn selector_keeps_only_the_selected_display() {
    let samples = vec![
        monitor("1", (0, 0), (1920, 1080), 1.0),
        monitor("2", (1920, 0), (1920, 1080), 1.0),
    ];
    let selected = lay_out(samples, &DisplaySelector::Id("2".into())).unwrap();
    let ids = selected
        .iter()
        .map(|((), display)| display.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, ["2"]);
    assert_eq!((selected[0].1.pixel_x, selected[0].1.pixel_y), (0, 0));
}

#[test]
fn mixed_scales_preserve_physical_monitor_rectangles() {
    let laid_out = displays(vec![
        monitor("2", (3840, 0), (3840, 2160), 2.0),
        monitor("1", (0, 0), (1920, 1080), 1.0),
    ]);
    let rects = laid_out
        .iter()
        .map(|d| (d.id.as_str(), d.x, d.pixel_x, d.pixel_width, d.pixel_height))
        .collect::<Vec<_>>();
    assert_eq!(rects, [("1", 0, 0, 1920, 1080), ("2", 3840, 3840, 3840, 2160)]);
}

#[test]
fn adjacent_mixed_dpi_monitors_keep_non_overlapping_physical_ranges() {
    let laid_out = displays(vec![
        monitor("1", (0, 0), (1920, 1080), 1.0),
        monitor("2", (1920, 0), (3840, 2160), 2.0),
    ]);

    assert_eq!(
        laid_out
            .iter()
            .map(|display| {
                (
                    display.x,
                    display.width,
                    display.pixel_x,
                    display.pixel_width,
                )
            })
            .collect::<Vec<_>>(),
        [(0, 1920, 0, 1920), (1920, 3840, 1920, 3840)]
    );
}

#[test]
fn negative_monitor_origins_round_trip_from_capture_pixels() {
    let laid_out = displays(vec![
        monitor("1", (-2560, -200), (2560, 1440), 2.0),
        monitor("2", (0, 0), (1920, 1080), 1.0),
    ]);
    let frame = FrameGeometry::for_displays(&laid_out);

    assert_eq!(
        frame.map_point(100.0, 100.0, None).unwrap(),
        (-2460.0, -100.0)
    );
    assert_eq!(
        frame.map_point(2660.0, 400.0, None).unwrap(),
        (100.0, 200.0)
    );
    assert!(frame.map_point(3000.0, 100.0, None).is_err());
}

#[test]
fn displays_order_top_to_bottom_then_left_to_right() {
    let laid_out = displays(vec![
        monitor("3", (1920, 1080), (1920, 1080), 1.0),
        monitor("2", (1920, 0), (1920, 1080), 1.0),
        monitor("1", (0, 0), (1920, 1080), 1.0),
    ]);
    let ids = laid_out.iter().map(|d| d.id.as_str()).collect::<Vec<_>>();
    assert_eq!(ids, ["1", "2", "3"]);
}

#[test]
fn nonpositive_scale_is_capture_failed() {
    let error = lay_out(
        vec![monitor("1", (0, 0), (1920, 1080), 0.0)],
        &DisplaySelector::All,
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::CaptureFailed);
}

#[test]
fn composite_past_the_pixel_limit_is_capture_failed() {
    let error = lay_out(
        vec![monitor("1", (0, 0), (20_000, 20_000), 1.0)],
        &DisplaySelector::All,
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::CaptureFailed);
}

#[test]
fn window_rect_stays_in_physical_desktop_pixels() {
    let laid_out = displays(vec![monitor("1", (0, 0), (2880, 1620), 1.5)]);
    let rect = PhysicalRect {
        x: 300,
        y: 150,
        width: 1500,
        height: 900,
    };
    assert_eq!(logical_window_rect(rect, &laid_out), (300, 150, 1500, 900));
}

#[test]
fn window_off_every_display_keeps_its_physical_rect() {
    let laid_out = displays(vec![monitor("1", (0, 0), (2880, 1620), 1.5)]);
    let rect = PhysicalRect {
        x: -32_000,
        y: -32_000,
        width: 160,
        height: 28,
    };
    assert_eq!(logical_window_rect(rect, &laid_out), (-32_000, -32_000, 160, 28));
}

#[test]
fn composite_places_each_matching_capture_at_its_pixel_rect() {
    let laid_out = displays(vec![
        monitor("1", (0, 0), (100, 50), 1.0),
        monitor("2", (200, 0), (200, 100), 2.0),
    ]);
    let red = RgbaImage::from_pixel(100, 50, Rgba([255, 0, 0, 255]));
    let blue = RgbaImage::from_pixel(200, 100, Rgba([0, 0, 255, 255]));
    let regions = laid_out.into_iter().zip([red, blue]).collect::<Vec<_>>();
    let (image, _geometry) = composite(regions).unwrap();
    assert_eq!((image.width(), image.height()), (400, 100));
    assert_eq!(image.get_pixel(99, 49), &Rgba([255, 0, 0, 255]));
    assert_eq!(image.get_pixel(199, 99), &Rgba([0, 0, 0, 255]));
    assert_eq!(image.get_pixel(200, 0), &Rgba([0, 0, 255, 255]));
    assert_eq!(image.get_pixel(399, 99), &Rgba([0, 0, 255, 255]));
}

#[test]
fn monitor_capture_geometry_changes_are_stale() {
    let [display] = displays(vec![monitor("1", (0, 0), (1920, 1080), 1.0)])
        .try_into()
        .unwrap();
    let stale = RgbaImage::new(1919, 1080);

    assert!(!capture_geometry_matches(&display, &stale));
    let error = composite(vec![(display, stale)]).unwrap_err();
    assert_eq!(error.code, ErrorCode::CaptureFailed);
}

#[test]
fn element_bounds_stay_fractional_in_logical_coordinates() {
    let laid_out = displays(vec![monitor("1", (0, 0), (2880, 1620), 1.5)]);
    let rect = PhysicalRect {
        x: 301,
        y: 150,
        width: 25,
        height: 10,
    };
    let bounds = logical_bounds(rect, &laid_out);
    assert_eq!(
        (bounds.x, bounds.y, bounds.width, bounds.height),
        (301.0, 150.0, 25.0, 10.0)
    );
}

#[test]
fn physical_point_is_not_rescaled_by_monitor_dpi() {
    let laid_out = displays(vec![
        monitor("1", (0, 0), (1920, 1080), 1.0),
        monitor("2", (1920, 0), (3840, 2160), 2.0),
    ]);
    assert_eq!(physical_point(1930.0, 10.0, &laid_out), Some((1930, 10)));
}

#[test]
fn physical_point_off_every_display_is_rejected() {
    let laid_out = displays(vec![monitor("1", (0, 0), (2880, 1620), 1.5)]);
    assert_eq!(physical_point(-10.0, 4000.0, &laid_out), None);
}

#[test]
fn logical_point_without_displays_is_none() {
    assert_eq!(physical_point(1.0, 1.0, &[]), None);
}
