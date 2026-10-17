//! A ScreenCast stream that reports no logical size must not silently mean
//! scale 1: its size comes from the libei region at its position, or the
//! composite's geometry is unknown.

use image::RgbaImage;
use senpi_desktop_core::frame::FrameGeometry;

use super::screencast::MonitorStream;
use super::{composite, Geometry};
use crate::capture::layout::EisRegion;

const fn monitor(node: u32, position: (i32, i32), size: Option<(i32, i32)>) -> MonitorStream {
    MonitorStream {
        node,
        position,
        size,
    }
}

const fn region(x: u32, width: u32, height: u32, scale: f32) -> EisRegion {
    EisRegion {
        x,
        y: 0,
        width,
        height,
        scale,
    }
}

#[test]
fn a_stream_without_a_size_and_no_eis_layout_has_unknown_geometry() {
    for unsized_monitor in [monitor(1, (0, 0), None), monitor(2, (0, 0), Some((0, 0)))] {
        let cast = composite(&[(unsized_monitor, RgbaImage::new(1920, 1080))], None);
        assert_eq!(cast.geometry, Geometry::Unknown, "{unsized_monitor:?}");
    }
}

#[test]
fn a_stream_without_a_size_takes_its_logical_size_from_the_eis_region() {
    let regions = [region(0, 1280, 720, 2.0)];

    let cast = composite(&[(monitor(1, (0, 0), None), RgbaImage::new(2560, 1440))], Some(&regions));

    assert_eq!(cast.geometry, Geometry::FromEis);
    let display = &cast.displays[0];
    assert_eq!((display.width, display.height, display.scale), (1280, 720, 2.0));
    assert_eq!(
        FrameGeometry::for_displays(&cast.displays).map_point(1000.0, 600.0, None),
        Ok((500.0, 300.0))
    );
}

#[test]
fn an_eis_region_that_does_not_fit_the_unsized_frame_leaves_geometry_unknown() {
    let regions = [region(0, 1280, 720, 1.5)];

    let cast = composite(&[(monitor(1, (0, 0), None), RgbaImage::new(2560, 1440))], Some(&regions));

    assert_eq!(cast.geometry, Geometry::Unknown);
}

#[test]
fn one_unsized_stream_makes_the_whole_composite_unknown() {
    let sized = monitor(1, (0, 0), Some((1280, 720)));
    let unsized_monitor = monitor(2, (1280, 0), None);
    let regions = [region(0, 1280, 720, 2.0)];

    let cast = composite(
        &[
            (sized, RgbaImage::new(2560, 1440)),
            (unsized_monitor, RgbaImage::new(1920, 1080)),
        ],
        Some(&regions),
    );

    assert_eq!(cast.geometry, Geometry::Unknown, "no region sits at (1280, 0)");
}

#[test]
fn streams_that_report_their_size_need_no_eis_layout() {
    let cast = composite(
        &[(monitor(1, (0, 0), Some((1280, 720))), RgbaImage::new(2560, 1440))],
        None,
    );
    assert_eq!(cast.geometry, Geometry::Reported);
    assert_eq!(cast.displays[0].scale, 2.0);
}
