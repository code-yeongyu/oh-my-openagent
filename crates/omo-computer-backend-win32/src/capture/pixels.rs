//! Pixel operations on BGRA frames: the near-black oracle, the blank-frame check, cropping,
//! the display composite, the crosshair and PNG encoding.

use super::RawFrame;
use crate::displays::PhysRect;

/// A pixel is near black when each of B, G and R is at most this value
/// (SP-N #13145@e0e08a126e:n-capture-printwindow-active, the probe's classifier).
pub const NEAR_BLACK_CHANNEL_MAX: u8 = 16;
/// Every 4th pixel is sampled (d-windows.md:80; SP-N #13145@e0e08a126e:n-capture-printwindow-active).
pub const NEAR_BLACK_STRIDE: usize = 4;
/// A frame whose sampled pixels are at least 98 % near black is `CaptureFailed{black_frame}`
/// (d-windows.md:80).
pub const NEAR_BLACK_FRACTION: f64 = 0.98;

/// The near-black oracle of the `PrintWindow` floor.
#[must_use]
pub fn is_near_black(bgra: &[u8]) -> bool {
    let mut sampled = 0u64;
    let mut black = 0u64;
    for pixel in bgra.as_chunks::<4>().0.iter().step_by(NEAR_BLACK_STRIDE) {
        sampled += 1;
        if pixel[..3]
            .iter()
            .all(|channel| *channel <= NEAR_BLACK_CHANNEL_MAX)
        {
            black += 1;
        }
    }
    if sampled == 0 {
        return true;
    }
    #[allow(clippy::cast_precision_loss)]
    let fraction = black as f64 / sampled as f64;
    fraction >= NEAR_BLACK_FRACTION
}

/// A WGC frame that is fully transparent or fully black (d-windows.md '## Capture': the floor
/// runs once for it).
#[must_use]
pub fn is_blank(bgra: &[u8]) -> bool {
    bgra.as_chunks::<4>()
        .0
        .iter()
        .all(|pixel| pixel[3] == 0 || pixel[..3].iter().all(|channel| *channel == 0))
}

/// The part of `frame` inside `area` (virtual-screen pixels), or `None` when they do not meet.
#[must_use]
pub fn crop(frame: &RawFrame, area: &PhysRect) -> Option<RawFrame> {
    let left = area.x.max(frame.origin.x);
    let top = area.y.max(frame.origin.y);
    let right = area.right().min(frame.origin.right());
    let bottom = area.bottom().min(frame.origin.bottom());
    if right <= left || bottom <= top {
        return None;
    }
    let stride = usize::try_from(frame.width).ok()? * 4;
    let width = usize::try_from(right - left).ok()?;
    let mut bgra = Vec::with_capacity(width * 4 * usize::try_from(bottom - top).ok()?);
    for y in top..bottom {
        let row = usize::try_from(y - frame.origin.y).ok()? * stride;
        let start = row + usize::try_from(left - frame.origin.x).ok()? * 4;
        bgra.extend_from_slice(frame.bgra.get(start..start + width * 4)?);
    }
    Some(RawFrame {
        width: u32::try_from(width).ok()?,
        height: u32::try_from(bottom - top).ok()?,
        bgra,
        origin: PhysRect {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        },
    })
}

/// Places every display frame at its physical position on one canvas covering them all;
/// uncovered gaps stay black. `None` when there is no frame.
#[must_use]
pub fn composite(frames: &[RawFrame]) -> Option<RawFrame> {
    if let [one] = frames {
        return Some(one.clone());
    }
    let origins: Vec<PhysRect> = frames.iter().map(|frame| frame.origin).collect();
    let bound = PhysRect::bounding(&origins);
    if frames.is_empty() || bound.width <= 0 || bound.height <= 0 {
        return None;
    }
    let stride = usize::try_from(bound.width).ok()? * 4;
    let mut bgra = vec![0u8; stride * usize::try_from(bound.height).ok()?];
    for frame in frames {
        let source = usize::try_from(frame.width).ok()? * 4;
        let dx = usize::try_from(frame.origin.x - bound.x).ok()? * 4;
        for row in 0..usize::try_from(frame.height).ok()? {
            let dy = (usize::try_from(frame.origin.y - bound.y).ok()? + row) * stride;
            let from = frame.bgra.get(row * source..(row + 1) * source)?;
            bgra.get_mut(dy + dx..dy + dx + source)?
                .copy_from_slice(from);
        }
    }
    Some(RawFrame {
        width: u32::try_from(bound.width).ok()?,
        height: u32::try_from(bound.height).ok()?,
        bgra,
        origin: bound,
    })
}

/// The arm length of the crosshair either side of its centre.
const CROSSHAIR_ARM: i64 = 4;

/// Draws a white crosshair centred at the frame point `(x, y)`.
pub fn draw_crosshair(bgra: &mut [u8], width: u32, height: u32, x: f64, y: f64) {
    #[allow(clippy::cast_possible_truncation)]
    let (cx, cy) = (x.round() as i64, y.round() as i64);
    for offset in -CROSSHAIR_ARM..=CROSSHAIR_ARM {
        for (px, py) in [(cx + offset, cy), (cx, cy + offset)] {
            if px < 0 || py < 0 || px >= i64::from(width) || py >= i64::from(height) {
                continue;
            }
            let Ok(at) = usize::try_from((py * i64::from(width) + px) * 4) else {
                continue;
            };
            if let Some(pixel) = bgra.get_mut(at..at + 4) {
                pixel.copy_from_slice(&[0xFF, 0xFF, 0xFF, 0xFF]);
            }
        }
    }
}

/// Encodes BGRA rows as an opaque RGBA PNG.
///
/// # Errors
/// The encoder fails or the buffer does not match the dimensions.
pub fn encode_png(width: u32, height: u32, bgra: &[u8]) -> Result<Vec<u8>, image::ImageError> {
    let mut rgba = Vec::with_capacity(bgra.len());
    for pixel in bgra.as_chunks::<4>().0 {
        rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 0xFF]);
    }
    let mut out = Vec::new();
    image::write_buffer_with_format(
        &mut std::io::Cursor::new(&mut out),
        &rgba,
        width,
        height,
        image::ExtendedColorType::Rgba8,
        image::ImageFormat::Png,
    )?;
    Ok(out)
}
