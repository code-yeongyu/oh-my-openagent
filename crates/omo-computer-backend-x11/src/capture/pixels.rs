//! ZPixmap decoding, the XFixes cursor composite, the crosshair falsifier and PNG encoding.

use std::io::Cursor;

use image::{ImageFormat, Rgba, RgbaImage};

use super::server::{ChannelMasks, CursorImage, XError, ZImage};

/// The gray of the crosshair a `crosshair` capture draws.
pub const CROSSHAIR_GRAY: u8 = 0x80;
/// The crosshair's arm length either side of its centre, in frame pixels.
pub const CROSSHAIR_ARM: i64 = 8;

fn channel(value: u32, mask: u32) -> u8 {
    if mask == 0 {
        return 0;
    }
    let shift = mask.trailing_zeros();
    let bits = (mask >> shift).count_ones();
    let raw = u64::from((value & mask) >> shift);
    let max = (1_u64 << bits) - 1;
    u8::try_from((raw * 255 + max / 2) / max).unwrap_or(u8::MAX)
}

fn pixel_value(bytes: &[u8], msb_first: bool) -> u32 {
    let fold = |acc: u32, byte: &u8| (acc << 8) | u32::from(*byte);
    if msb_first {
        bytes.iter().fold(0, fold)
    } else {
        bytes.iter().rev().fold(0, fold)
    }
}

/// Decodes a TrueColor ZPixmap of 16, 24 or 32 bits per pixel to opaque RGBA.
///
/// # Errors
/// Another pixel size, or fewer bytes than the scanlines need.
pub fn decode(image: &ZImage) -> Result<RgbaImage, XError> {
    let bits = usize::from(image.bits_per_pixel);
    if !matches!(bits, 16 | 24 | 32) {
        return Err(XError(format!("unsupported ZPixmap of {bits} bits per pixel")));
    }
    let pad = usize::from(image.scanline_pad.max(8));
    let width = usize::try_from(image.width).map_err(|_| XError("image too wide".into()))?;
    let height = usize::try_from(image.height).map_err(|_| XError("image too tall".into()))?;
    let stride = (width * bits).div_ceil(pad) * pad / 8;
    if image.data.len() < stride * height {
        return Err(XError(format!(
            "ZPixmap holds {} bytes, {width}x{height} needs {}",
            image.data.len(),
            stride * height
        )));
    }
    let step = bits / 8;
    let ChannelMasks { red, green, blue } = image.masks;
    Ok(RgbaImage::from_fn(image.width, image.height, |x, y| {
        let start = y as usize * stride + x as usize * step;
        let value = pixel_value(&image.data[start..start + step], image.msb_first);
        Rgba([channel(value, red), channel(value, green), channel(value, blue), u8::MAX])
    }))
}

/// Composites the premultiplied ARGB cursor with its top-left at `(left, top)` in frame
/// pixels: the glyph is never scaled, so it stays in device pixels.
pub fn blend_cursor(canvas: &mut RgbaImage, cursor: &CursorImage, left: i64, top: i64) {
    for row in 0..cursor.height {
        for column in 0..cursor.width {
            let index = (row * cursor.width + column) as usize;
            let Some(&argb) = cursor.argb.get(index) else {
                return;
            };
            let alpha = argb >> 24;
            if alpha == 0 {
                continue;
            }
            let (x, y) = (left + i64::from(column), top + i64::from(row));
            let (Ok(x), Ok(y)) = (u32::try_from(x), u32::try_from(y)) else {
                continue;
            };
            if x >= canvas.width() || y >= canvas.height() {
                continue;
            }
            let destination = canvas.get_pixel_mut(x, y);
            let source = [(argb >> 16) & 0xFF, (argb >> 8) & 0xFF, argb & 0xFF];
            for (channel, value) in destination.0.iter_mut().zip(source) {
                let under = u32::from(*channel) * (255 - alpha) / 255;
                *channel = u8::try_from((value + under).min(255)).unwrap_or(u8::MAX);
            }
            destination.0[3] = u8::MAX;
        }
    }
}

/// Draws the crosshair centred on `(x, y)` in frame pixels.
pub fn crosshair(canvas: &mut RgbaImage, x: f64, y: f64) {
    if !x.is_finite() || !y.is_finite() {
        return;
    }
    #[allow(clippy::cast_possible_truncation)]
    let (centre_x, centre_y) = (x.round() as i64, y.round() as i64);
    let gray = Rgba([CROSSHAIR_GRAY, CROSSHAIR_GRAY, CROSSHAIR_GRAY, u8::MAX]);
    for offset in -CROSSHAIR_ARM..=CROSSHAIR_ARM {
        for (px, py) in [(centre_x + offset, centre_y), (centre_x, centre_y + offset)] {
            if let (Ok(px), Ok(py)) = (u32::try_from(px), u32::try_from(py)) {
                if px < canvas.width() && py < canvas.height() {
                    canvas.put_pixel(px, py, gray);
                }
            }
        }
    }
}

/// PNG bytes of the frame.
///
/// # Errors
/// The encoder failed.
pub fn png(image: &RgbaImage) -> Result<Vec<u8>, XError> {
    let mut bytes = Cursor::new(Vec::new());
    image
        .write_to(&mut bytes, ImageFormat::Png)
        .map_err(|error| XError(format!("PNG encoding failed: {error}")))?;
    Ok(bytes.into_inner())
}
