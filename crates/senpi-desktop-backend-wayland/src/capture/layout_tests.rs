use senpi_desktop_core::frame::FrameGeometry;

use super::layout::{derive_displays, monitor_size, EisRegion};

const fn region(x: u32, y: u32, width: u32, height: u32, scale: f32) -> EisRegion {
    EisRegion {
        x,
        y,
        width,
        height,
        scale,
    }
}

fn derive(width: u32, height: u32, regions: &[EisRegion]) -> Option<FrameGeometry> {
    derive_displays(width, height, regions, "wayland-portal-", "Wayland portal screenshot")
        .map(|displays| FrameGeometry::for_displays(&displays))
}

fn scales(width: u32, height: u32, regions: &[EisRegion]) -> Option<Vec<f64>> {
    derive_displays(width, height, regions, "p-", "p")
        .map(|displays| displays.iter().map(|display| display.scale).collect())
}

#[test]
fn an_unscaled_single_region_maps_pixels_one_to_one() {
    let frame = derive(1920, 1080, &[region(0, 0, 1920, 1080, 1.0)]).expect("1x layout");
    assert_eq!(frame.map_point(100.0, 50.0, None), Ok((100.0, 50.0)));
}

#[test]
fn a_2x_physical_screenshot_maps_back_to_logical_points() {
    let frame = derive(2560, 1440, &[region(0, 0, 1280, 720, 2.0)]).expect("2x layout");
    assert_eq!(frame.map_point(1000.0, 600.0, None), Ok((500.0, 300.0)));
    assert_eq!(scales(2560, 1440, &[region(0, 0, 1280, 720, 2.0)]), Some(vec![2.0]));
}

#[test]
fn a_fractional_scale_is_accepted_within_one_pixel_of_rounding() {
    let scaled = [region(0, 0, 1280, 720, 1.25)];
    let frame = derive(1600, 900, &scaled).expect("1.25x layout");
    assert_eq!(frame.map_point(800.0, 450.0, None), Ok((640.0, 360.0)));
    assert!(derive(1601, 899, &scaled).is_some(), "one pixel of rounding");
    assert!(derive(1602, 900, &scaled).is_none(), "two pixels off is not this layout");
}

#[test]
fn a_logical_size_composite_of_a_scaled_output_maps_at_scale_one() {
    assert_eq!(scales(1280, 720, &[region(0, 0, 1280, 720, 2.0)]), Some(vec![1.0]));
}

#[test]
fn an_aspect_mismatch_is_refused() {
    assert!(derive(2560, 1200, &[region(0, 0, 1280, 720, 2.0)]).is_none());
    assert!(derive(1920, 1080, &[region(0, 0, 1280, 720, 1.0)]).is_none());
}

#[test]
fn two_monitors_at_one_uniform_scale_map_each_into_its_own_region() {
    let regions = [region(0, 0, 1280, 720, 2.0), region(1280, 0, 1280, 720, 2.0)];
    let frame = derive(5120, 1440, &regions).expect("uniform 2x pair");
    assert_eq!(frame.map_point(2660.0, 50.0, None), Ok((1330.0, 25.0)));
}

#[test]
fn a_layout_offset_from_the_origin_keeps_global_logical_coordinates() {
    let frame = derive(1280, 720, &[region(100, 50, 640, 360, 2.0)]).expect("offset 2x");
    assert_eq!(frame.map_point(0.0, 0.0, None), Ok((100.0, 50.0)));
}

#[test]
fn a_gap_between_monitors_maps_to_no_region() {
    let regions = [region(0, 0, 100, 100, 1.0), region(200, 0, 100, 100, 1.0)];
    let frame = derive(300, 100, &regions).expect("gapped layout");
    assert_eq!(frame.map_point(250.0, 50.0, None), Ok((250.0, 50.0)));
    assert!(frame.map_point(150.0, 50.0, None).is_err(), "the gap is no display");
}

#[test]
fn mixed_per_region_scales_are_refused_at_every_candidate_size() {
    let mixed = [region(0, 0, 1280, 720, 2.0), region(1280, 0, 1920, 1080, 1.0)];
    for (width, height) in [(3200, 1080), (6400, 2160), (4480, 1440)] {
        assert!(derive(width, height, &mixed).is_none(), "{width}x{height}");
    }
}

#[test]
fn a_multi_monitor_screenshot_sized_for_another_scale_is_refused() {
    let fractional = [region(0, 0, 1280, 720, 1.5), region(1280, 0, 1280, 720, 1.5)];
    assert!(derive(3840, 1080, &fractional).is_some(), "the 1.5x size itself");
    assert!(derive(5120, 1440, &fractional).is_none(), "a 2x-sized image");
}

#[test]
fn an_unset_scale_on_one_region_accepts_only_exact_1x_or_2x() {
    let unset = [region(0, 0, 1280, 720, 0.0)];
    assert_eq!(scales(2560, 1440, &unset), Some(vec![2.0]));
    assert_eq!(scales(1280, 720, &unset), Some(vec![1.0]));
    assert!(derive(2816, 1584, &unset).is_none(), "2.2x is a guess, not a layout");
    let two_unset = [region(0, 0, 1280, 720, 0.0), region(1280, 0, 1280, 720, 0.0)];
    assert!(derive(5120, 1440, &two_unset).is_none());
}

#[test]
fn unusable_regions_or_images_are_refused() {
    let one = region(0, 0, 1280, 720, 1.0);
    assert!(derive(1280, 720, &[]).is_none(), "no regions");
    assert!(derive(0, 720, &[one]).is_none(), "empty image");
    assert!(derive(1280, 720, &[region(0, 0, 0, 720, 1.0)]).is_none(), "empty region");
    assert!(derive(1280, 720, &[region(0, 0, 1280, 720, f32::NAN)]).is_none(), "NaN scale");
    let overlapping = [one, region(640, 0, 1280, 720, 1.0)];
    assert!(derive(1920, 720, &overlapping).is_none(), "overlapping regions");
}

#[test]
fn derived_displays_carry_ids_logical_rects_and_pixel_rects() {
    let regions = [region(0, 0, 1280, 720, 2.0), region(1280, 0, 1280, 720, 2.0)];
    let displays = derive_displays(5120, 1440, &regions, "wayland-portal-", "Wayland portal screenshot")
        .expect("uniform 2x pair");
    let summary: Vec<_> = displays
        .iter()
        .map(|d| (d.id.as_str(), d.x, d.width, d.pixel_x, d.pixel_width, d.is_primary))
        .collect();
    assert_eq!(
        summary,
        [
            ("wayland-portal-0", 0, 1280, 0, 2560, true),
            ("wayland-portal-1", 1280, 1280, 2560, 2560, false),
        ]
    );
}

#[test]
fn an_unsized_monitor_takes_the_region_at_its_position() {
    let regions = [region(0, 0, 1280, 720, 2.0), region(1280, 0, 1920, 1080, 1.0)];
    assert_eq!(monitor_size((0, 0), 2560, 1440, &regions), Some((1280, 720)));
    assert_eq!(monitor_size((1280, 0), 1920, 1080, &regions), Some((1920, 1080)));
}

#[test]
fn an_unsized_monitor_without_one_matching_region_stays_unknown() {
    let regions = [region(0, 0, 1280, 720, 1.5)];
    assert_eq!(monitor_size((0, 0), 2560, 1440, &regions), None, "frame is not 1.5x");
    assert_eq!(monitor_size((640, 0), 1920, 1080, &regions), None, "no region there");
    assert_eq!(monitor_size((-1, 0), 1920, 1080, &regions), None, "negative position");
    let mirrored = [region(0, 0, 1280, 720, 2.0), region(0, 0, 1280, 720, 2.0)];
    assert_eq!(monitor_size((0, 0), 2560, 1440, &mirrored), None, "ambiguous region");
}
