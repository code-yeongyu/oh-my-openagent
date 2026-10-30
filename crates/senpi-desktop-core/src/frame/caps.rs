use image::imageops::FilterType;
use image::RgbaImage;

use super::{round_to_u32, FrameGeometry};
use crate::error::{CoreResult, DesktopError};
use crate::types::CaptureCaps;

pub const MAX_COMPOSITE_PIXELS: u64 = 268_435_456;

/// Downscales `image` to fit `caps` (aspect preserved) and rescales the frame
/// so later pointer coordinates still map back to the right logical points.
pub fn apply_capture_caps(
    image: RgbaImage,
    geometry: &mut FrameGeometry,
    caps: &CaptureCaps,
) -> CoreResult<RgbaImage> {
    if image.width() == 0 || image.height() == 0 {
        return Err(DesktopError::capture_failed("capture returned an empty image"));
    }
    if caps.max_width == Some(0) || caps.max_height == Some(0) {
        return Err(DesktopError::invalid_target(
            "capture caps must be greater than zero",
        ));
    }
    let mut ratio = 1.0f64;
    if let Some(max_width) = caps.max_width {
        ratio = ratio.min(f64::from(max_width) / f64::from(image.width()));
    }
    if let Some(max_height) = caps.max_height {
        ratio = ratio.min(f64::from(max_height) / f64::from(image.height()));
    }
    let width = round_to_u32(f64::from(image.width()) * ratio).max(1);
    let height = round_to_u32(f64::from(image.height()) * ratio).max(1);
    if u64::from(width) * u64::from(height) > MAX_COMPOSITE_PIXELS {
        return Err(DesktopError::capture_failed(format!(
            "composite {width}x{height} exceeds the native safety limit"
        )));
    }
    if width == image.width() && height == image.height() {
        return Ok(image);
    }
    let ratio_x = f64::from(width) / f64::from(image.width());
    let ratio_y = f64::from(height) / f64::from(image.height());
    geometry.scaled(ratio_x, ratio_y, width, height);
    Ok(image::imageops::resize(
        &image,
        width,
        height,
        FilterType::Triangle,
    ))
}
