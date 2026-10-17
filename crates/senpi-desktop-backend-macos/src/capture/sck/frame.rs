//! Conversion of one helper frame (packed premultiplied BGRA) into an
//! `RgbaImage` plus the captured window's metadata.

use image::RgbaImage;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::MAX_COMPOSITE_PIXELS;

/// One decoded helper frame.
#[derive(Debug)]
pub(crate) struct Frame {
    pub image: RgbaImage,
    pub bounds: (f64, f64, f64, f64),
    pub is_on_screen: Option<bool>,
    pub pid: Option<i32>,
}

impl Frame {
    pub(crate) fn into_image(self) -> RgbaImage {
        self.image
    }
}

/// Byte length of a `width`x`height` packed BGRA frame, under the pixel cap.
pub(crate) fn frame_bytes(width: u32, height: u32) -> CoreResult<usize> {
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_COMPOSITE_PIXELS {
        return Err(DesktopError::capture_failed(
            "native screenshot dimensions exceed the safety limit",
        ));
    }
    usize::try_from(u64::from(width) * u64::from(height) * 4)
        .map_err(|_| DesktopError::capture_failed("native screenshot byte length overflow"))
}

/// BGRA premultiplied -> RGBA straight, in place (ported from oh-my-pi
/// `screen_capture_kit.rs::unpremultiply`).
fn unpremultiply_bgra(pixels: &mut [u8]) {
    for pixel in pixels.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
        let alpha = u32::from(pixel[3]);
        match alpha {
            0 => pixel[..3].fill(0),
            255 => {},
            _ => {
                for channel in &mut pixel[..3] {
                    *channel = ((u32::from(*channel) * 255 + alpha / 2) / alpha).min(255) as u8;
                }
            },
        }
    }
}

/// Validates the announced geometry and converts the pixels.
pub(crate) fn decode(
    width: u32,
    height: u32,
    byte_length: usize,
    pixels: Vec<u8>,
    bounds: (f64, f64, f64, f64),
    is_on_screen: Option<bool>,
) -> CoreResult<Frame> {
    if frame_bytes(width, height)? != byte_length || pixels.len() != byte_length {
        return Err(DesktopError::capture_failed(
            "capture worker returned inconsistent frame metadata",
        ));
    }
    let mut pixels = pixels;
    unpremultiply_bgra(&mut pixels);
    let image = RgbaImage::from_raw(width, height, pixels)
        .ok_or_else(|| DesktopError::capture_failed("capture worker returned an invalid pixel buffer"))?;
    Ok(Frame {
        image,
        bounds,
        is_on_screen,
        pid: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bgra_becomes_rgba_and_transparent_edges_unpremultiply() {
        // B,G,R,A order on the wire; semi-transparent blue and a clear pixel.
        let pixels = vec![56, 34, 12, 255, 0, 32, 64, 128, 9, 8, 7, 0, 255, 0, 0, 1];
        let frame = decode(2, 2, 16, pixels, (0.0, 0.0, 2.0, 2.0), Some(true)).unwrap();
        let data = frame.image.into_raw();
        assert_eq!(
            data,
            vec![12, 34, 56, 255, 128, 64, 0, 128, 0, 0, 0, 0, 0, 0, 255, 1]
        );
    }

    #[test]
    fn hidpi_dimensions_are_capped_and_zero_edges_rejected() {
        assert_eq!(frame_bytes(1001, 672).unwrap(), 1001 * 672 * 4);
        assert!(frame_bytes(0, 10).is_err());
        assert!(frame_bytes(u32::MAX, u32::MAX).is_err());
        let too_short = decode(2, 2, 12, vec![0; 12], (0.0, 0.0, 2.0, 2.0), None);
        assert!(too_short.is_err());
    }
}
