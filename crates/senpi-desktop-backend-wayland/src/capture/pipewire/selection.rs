use image::{imageops, RgbaImage};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{DesktopDisplay, DisplaySelector};

use super::DISPLAY_PREFIX;

pub(crate) fn select_capture(
    selector: &DisplaySelector,
    image: RgbaImage,
    displays: Vec<DesktopDisplay>,
) -> CoreResult<(RgbaImage, Vec<DesktopDisplay>)> {
    let DisplaySelector::Id(id) = selector else {
        return Ok((image, displays));
    };
    if !id.starts_with(DISPLAY_PREFIX) {
        return Ok((image, displays));
    }
    let mut display = displays
        .into_iter()
        .find(|display| display.id == *id)
        .ok_or_else(|| {
            DesktopError::invalid_target(format!(
                "Wayland ScreenCast display '{id}' was not returned by the portal"
            ))
        })?;
    let right = display
        .pixel_x
        .checked_add(display.pixel_width)
        .ok_or_else(|| DesktopError::capture_failed("Wayland ScreenCast display width overflow"))?;
    let bottom = display
        .pixel_y
        .checked_add(display.pixel_height)
        .ok_or_else(|| {
            DesktopError::capture_failed("Wayland ScreenCast display height overflow")
        })?;
    if right > image.width() || bottom > image.height() {
        return Err(DesktopError::capture_failed(format!(
            "Wayland ScreenCast display '{id}' lies outside the captured composite"
        )));
    }
    let selected = imageops::crop_imm(
        &image,
        display.pixel_x,
        display.pixel_y,
        display.pixel_width,
        display.pixel_height,
    )
    .to_image();
    display.pixel_x = 0;
    display.pixel_y = 0;
    Ok((selected, vec![display]))
}
