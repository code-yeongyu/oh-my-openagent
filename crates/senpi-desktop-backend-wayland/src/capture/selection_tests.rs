use image::RgbaImage;
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::DisplaySelector;

use super::layout::{derive_displays, EisRegion};
use super::{screenshot_required, PortalCapture, PORTAL_DISPLAY_ID, PORTAL_DISPLAY_PREFIX};

fn displays() -> Vec<senpi_desktop_core::types::DesktopDisplay> {
    let regions = [
        EisRegion { x: 0, y: 0, width: 2, height: 2, scale: 1.0 },
        EisRegion { x: 2, y: 0, width: 2, height: 2, scale: 1.0 },
    ];
    derive_displays(4, 2, &regions, PORTAL_DISPLAY_PREFIX, "portal").unwrap()
}

#[test]
fn explicit_portal_zero_keeps_the_whole_proven_screenshot() {
    // Given: two libei regions prove the Screenshot portal's image.
    let mut capture = PortalCapture::new(DisplaySelector::Active);
    let image = RgbaImage::from_pixel(4, 2, [7, 8, 9, 255].into());
    // When: the legacy whole-screenshot pseudo id is explicit.
    let (image, selected) = capture.select_frame(
        &DisplaySelector::Id(PORTAL_DISPLAY_ID.into()), image, displays(),
    ).unwrap();
    // Then: both regions and the whole image remain available.
    assert_eq!(image.dimensions(), (4, 2));
    assert_eq!(selected.len(), 2);
    assert_eq!(FrameGeometry::for_displays(&selected).map_point(3.0, 1.0, None), Ok((3.0, 1.0)));
}

#[test]
fn every_portal_id_forces_screenshot_even_when_screencast_is_available() {
    // Given: an explicit region of the Screenshot portal.
    let selector = DisplaySelector::Id("wayland-portal-1".into());
    // When: choosing the portal before attempting ScreenCast.
    let required = screenshot_required(&selector);
    // Then: never send this id to ScreenCast, whose ids have another prefix.
    assert!(required);
}

#[test]
fn selecting_one_region_retains_every_display_in_the_inventory() {
    // Given: an active-default capture with two known regions.
    let mut capture = PortalCapture::new(DisplaySelector::Active);
    let image = RgbaImage::from_pixel(4, 2, [7, 8, 9, 255].into());
    // When: a per-call target selects the second region.
    let (image, selected) = capture.select_frame(
        &DisplaySelector::Id("wayland-portal-1".into()), image, displays(),
    ).unwrap();
    // Then: the frame is local, while display discovery still lists the full atlas.
    assert_eq!(image.dimensions(), (2, 2));
    assert_eq!(selected.len(), 1);
    assert_eq!(FrameGeometry::for_displays(&selected).map_point(0.0, 0.0, None), Ok((2.0, 0.0)));
    assert_eq!(capture.displays(), displays());
}

#[test]
fn active_uses_the_first_reported_display_and_keeps_the_full_inventory() {
    // Given: the portal knows order but not the compositor's primary or focus.
    let mut capture = PortalCapture::new(DisplaySelector::Active);
    // When: capturing the default active target.
    let (_, selected) = capture.select_frame(
        &DisplaySelector::Active, RgbaImage::new(4, 2), displays(),
    ).unwrap();
    // Then: the first report is the fallback, not a reduced discoverable inventory.
    assert_eq!(selected[0].id, PORTAL_DISPLAY_ID);
    assert_eq!(capture.displays().len(), 2);
}

#[test]
fn an_unavailable_screencast_id_does_not_alias_a_screenshot_region() {
    // Given: only Screenshot portal regions are proven.
    let mut capture = PortalCapture::new(DisplaySelector::Active);
    // When: selecting an explicit ScreenCast id after its portal failed.
    let error = capture.select_frame(
        &DisplaySelector::Id("wayland-screencast-1".into()), RgbaImage::new(4, 2), displays(),
    ).unwrap_err();
    // Then: the requested display is unavailable, never a silently substituted image.
    assert_eq!(error.code, ErrorCode::InvalidTarget);
}
