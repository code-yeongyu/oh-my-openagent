//! Pixel work on captured frames: decode, the fully-transparent check, region crop, the
//! crosshair, the desktop composite and the PNG/JPEG encoders.

use image::codecs::jpeg::JpegEncoder;
use image::imageops::{self, FilterType};
use image::{ImageFormat, Rgba, RgbaImage};
use omo_computer_core::listing::Rect;
use omo_computer_core::params::Point;

use super::types::{CaptureFault, RawFrame};

/// Decodes a helper PNG into RGBA.
///
/// # Errors
/// [`CaptureFault::Protocol`] when the bytes are not a PNG.
pub fn decode_png(png: &[u8]) -> Result<RgbaImage, CaptureFault> {
    image::load_from_memory_with_format(png, ImageFormat::Png)
        .map(|image| image.to_rgba8())
        .map_err(|_| CaptureFault::Protocol)
}

/// The raw frame as an image; `None` when its buffer does not match its size.
#[must_use]
pub fn from_raw(frame: RawFrame) -> Option<RgbaImage> {
    RgbaImage::from_raw(frame.width, frame.height, frame.rgba)
}

/// Every pixel has alpha 0 (the SkyLight route's failure shape).
#[must_use]
pub fn fully_transparent(image: &RgbaImage) -> bool {
    image.pixels().all(|p| p.0[3] == 0)
}

/// Crops to `region`, given in the target's points; `scale` is pixels per point.
#[must_use]
pub fn crop(image: &RgbaImage, region: &Rect, scale: f64) -> RgbaImage {
    let px = |v: f64, max: u32| clamp_px(v * scale, max);
    let (x, y) = (px(region.x, image.width()), px(region.y, image.height()));
    let width = px(region.x + region.width, image.width()).saturating_sub(x);
    let height = px(region.y + region.height, image.height()).saturating_sub(y);
    imageops::crop_imm(image, x, y, width.max(1), height.max(1)).to_image()
}

/// Draws a one-pixel red crosshair through `point` (target points).
pub fn draw_crosshair(image: &mut RgbaImage, point: Point, scale: f64) {
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 {
        return;
    }
    let x = clamp_px(point.x * scale, width - 1);
    let y = clamp_px(point.y * scale, height - 1);
    let red = Rgba([255, 0, 0, 255]);
    for cx in 0..width {
        image.put_pixel(cx, y, red);
    }
    for cy in 0..height {
        image.put_pixel(x, cy, red);
    }
}

/// One display's frame and its bounds in desktop points.
pub struct Tile {
    pub bounds: Rect,
    pub image: RgbaImage,
}

/// The desktop composite at the largest display scale; each tile is resized to its bounds.
#[must_use]
pub fn composite(tiles: &[Tile], scale: f64) -> RgbaImage {
    let min_x = tiles
        .iter()
        .map(|t| t.bounds.x)
        .fold(f64::INFINITY, f64::min);
    let min_y = tiles
        .iter()
        .map(|t| t.bounds.y)
        .fold(f64::INFINITY, f64::min);
    let max_x = tiles
        .iter()
        .map(|t| t.bounds.x + t.bounds.width)
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = tiles
        .iter()
        .map(|t| t.bounds.y + t.bounds.height)
        .fold(f64::NEG_INFINITY, f64::max);
    let size = |v: f64| clamp_px(v * scale, u32::MAX).max(1);
    let mut canvas = RgbaImage::new(size(max_x - min_x), size(max_y - min_y));
    for tile in tiles {
        let resized = imageops::resize(
            &tile.image,
            size(tile.bounds.width),
            size(tile.bounds.height),
            FilterType::Triangle,
        );
        let x = i64::from(clamp_px((tile.bounds.x - min_x) * scale, u32::MAX));
        let y = i64::from(clamp_px((tile.bounds.y - min_y) * scale, u32::MAX));
        imageops::overlay(&mut canvas, &resized, x, y);
    }
    canvas
}

/// Scales so the long edge is at most `long_edge`, keeping the aspect ratio.
#[must_use]
pub fn fit_long_edge(image: &RgbaImage, long_edge: u32) -> RgbaImage {
    let (width, height) = image.dimensions();
    let longest = width.max(height);
    if longest <= long_edge || longest == 0 {
        return image.clone();
    }
    let ratio = f64::from(long_edge) / f64::from(longest);
    let w = clamp_px(f64::from(width) * ratio, long_edge).max(1);
    let h = clamp_px(f64::from(height) * ratio, long_edge).max(1);
    imageops::resize(image, w, h, FilterType::Triangle)
}

/// PNG bytes of `image`.
///
/// # Errors
/// [`CaptureFault::Protocol`] when encoding fails.
pub fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, CaptureFault> {
    let mut out = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut out, ImageFormat::Png)
        .map_err(|_| CaptureFault::Protocol)?;
    Ok(out.into_inner())
}

/// Baseline JPEG bytes of `image` at `quality` (1-100), alpha dropped.
///
/// # Errors
/// [`CaptureFault::Protocol`] when encoding fails.
pub fn encode_jpeg(image: &RgbaImage, quality: u8) -> Result<Vec<u8>, CaptureFault> {
    let rgb = image::DynamicImage::ImageRgba8(image.clone()).to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(&rgb)
        .map_err(|_| CaptureFault::Protocol)?;
    Ok(out)
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn clamp_px(value: f64, max: u32) -> u32 {
    if value.is_nan() || value <= 0.0 {
        0
    } else if value >= f64::from(max) {
        max
    } else {
        value.round() as u32
    }
}
