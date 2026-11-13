//! A window's region of the ScreenCast composite (oh-my-pi `window_crop`):
//! the window's logical bounds, from AT-SPI, scaled by the monitor its origin
//! lies on. A window whose origin is on no captured monitor is not captured.

use image::{imageops, RgbaImage};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopDisplay, DesktopWindow};

/// `(x, y, width, height)` in composite pixels.
pub fn window_crop(displays: &[DesktopDisplay], window: &DesktopWindow) -> Option<(u32, u32, u32, u32)> {
    let display = displays.iter().find(|display| {
        let (rel_x, rel_y) = (
            i64::from(window.x) - i64::from(display.x),
            i64::from(window.y) - i64::from(display.y),
        );
        (0..i64::from(display.width)).contains(&rel_x) && (0..i64::from(display.height)).contains(&rel_y)
    })?;
    let scale_x = f64::from(display.pixel_width) / f64::from(display.width.max(1));
    let scale_y = f64::from(display.pixel_height) / f64::from(display.height.max(1));
    let offset_x = to_pixels(f64::from(window.x - display.x) * scale_x);
    let offset_y = to_pixels(f64::from(window.y - display.y) * scale_y);
    if offset_x >= display.pixel_width || offset_y >= display.pixel_height {
        return None;
    }
    let width = to_pixels(f64::from(window.width) * scale_x)
        .max(1)
        .min(display.pixel_width - offset_x);
    let height = to_pixels(f64::from(window.height) * scale_y)
        .max(1)
        .min(display.pixel_height - offset_y);
    Some((
        display.pixel_x + offset_x,
        display.pixel_y + offset_y,
        width,
        height,
    ))
}

pub fn crop_window(
    composite: &RgbaImage,
    displays: &[DesktopDisplay],
    windows: Vec<DesktopWindow>,
    id: &str,
) -> CoreResult<(RgbaImage, FrameGeometry)> {
    let window = windows
        .into_iter()
        .find(|window| window.id == id)
        .ok_or_else(|| DesktopError::window_not_found(format!("Wayland window {id} not found")))?;
    let (x, y, width, height) = window_crop(displays, &window).ok_or_else(|| {
        DesktopError::capture_failed(format!("Wayland window {id} is outside every captured monitor"))
    })?;
    let cropped = imageops::crop_imm(composite, x, y, width, height).to_image();
    let frame = FrameGeometry::for_window(&window, cropped.width(), cropped.height());
    Ok((cropped, frame))
}

fn to_pixels(value: f64) -> u32 {
    let rounded = value.round();
    if rounded <= 0.0 {
        0
    } else if rounded >= f64::from(u32::MAX) {
        u32::MAX
    } else {
        // In (0, u32::MAX) by the guards above.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let whole = rounded as u32;
        whole
    }
}
