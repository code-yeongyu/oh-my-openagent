//! ZPixmap -> RGBA conversion for TrueColor visuals, and root clipping.

use image::RgbaImage;
use senpi_desktop_core::error::{CoreResult, DesktopError};

/// The root visual's TrueColor channel masks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ColorMasks {
    pub red: u32,
    pub green: u32,
    pub blue: u32,
}

/// A rectangle in root-window coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RootRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// A `GetImage(ZPixmap)` reply with the pixmap format it was encoded in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pixmap {
    pub width: u32,
    pub height: u32,
    pub depth: u8,
    pub bits_per_pixel: u8,
    pub scanline_pad: u8,
    pub lsb_first: bool,
    pub data: Vec<u8>,
}

#[derive(Clone, Copy)]
struct ComponentMask {
    mask: u32,
    shift: u32,
    max: u32,
}

impl ComponentMask {
    fn new(name: &str, mask: u32) -> CoreResult<Self> {
        if mask == 0 {
            return Err(DesktopError::capture_failed(format!(
                "X11 TrueColor {name} mask is zero"
            )));
        }
        let shift = mask.trailing_zeros();
        let max = mask >> shift;
        if max & max.wrapping_add(1) != 0 {
            return Err(DesktopError::capture_failed(format!(
                "X11 TrueColor {name} mask {mask:#x} is not contiguous"
            )));
        }
        Ok(Self { mask, shift, max })
    }

    /// Scales the channel to 0..=255 with rounding.
    fn decode(self, pixel: u32) -> u8 {
        let component = u64::from((pixel & self.mask) >> self.shift);
        let max = u64::from(self.max);
        u8::try_from((component * 255 + max / 2) / max).unwrap_or(u8::MAX)
    }
}

/// Decodes a TrueColor ZPixmap (depth 24..=32, 24 or 32 bits per pixel,
/// either byte order, any scanline pad) into opaque RGBA.
pub(crate) fn to_rgba(pixmap: &Pixmap, masks: ColorMasks) -> CoreResult<RgbaImage> {
    if !(24..=32).contains(&pixmap.depth) {
        return Err(DesktopError::capture_failed(format!(
            "unsupported X11 image depth {}; TrueColor depth 24 through 32 is required",
            pixmap.depth
        )));
    }
    let bytes_per_pixel = match pixmap.bits_per_pixel {
        24 => 3usize,
        32 => 4usize,
        other => {
            return Err(DesktopError::capture_failed(format!(
                "unsupported X11 pixel size of {other} bits per pixel"
            )));
        }
    };
    let red = ComponentMask::new("red", masks.red)?;
    let green = ComponentMask::new("green", masks.green)?;
    let blue = ComponentMask::new("blue", masks.blue)?;
    if masks.red & masks.green != 0 || masks.red & masks.blue != 0 || masks.green & masks.blue != 0 {
        return Err(DesktopError::capture_failed("X11 TrueColor masks overlap"));
    }
    let too_large = || DesktopError::capture_failed("X11 image dimensions exceed the address space");
    let width = usize::try_from(pixmap.width).map_err(|_| too_large())?;
    let height = usize::try_from(pixmap.height).map_err(|_| too_large())?;
    let pad_bits = usize::from(pixmap.scanline_pad).max(8);
    let row_bits = width
        .checked_mul(usize::from(pixmap.bits_per_pixel))
        .ok_or_else(too_large)?;
    let stride = row_bits.div_ceil(pad_bits) * pad_bits / 8;
    let needed = stride.checked_mul(height).ok_or_else(too_large)?;
    if needed > pixmap.data.len() {
        return Err(DesktopError::capture_failed(format!(
            "X11 image data is truncated: expected {needed} bytes, got {}",
            pixmap.data.len()
        )));
    }
    let row_bytes = width * bytes_per_pixel;
    let mut rgba = Vec::with_capacity(width.saturating_mul(height).saturating_mul(4));
    for row in pixmap.data.chunks_exact(stride.max(1)).take(height) {
        for pixel in row[..row_bytes].chunks_exact(bytes_per_pixel) {
            let value = if pixmap.lsb_first {
                pixel
                    .iter()
                    .rev()
                    .fold(0u32, |acc, &byte| acc << 8 | u32::from(byte))
            } else {
                pixel.iter().fold(0u32, |acc, &byte| acc << 8 | u32::from(byte))
            };
            rgba.extend_from_slice(&[red.decode(value), green.decode(value), blue.decode(value), 255]);
        }
    }
    RgbaImage::from_raw(pixmap.width, pixmap.height, rgba)
        .ok_or_else(|| DesktopError::capture_failed("X11 image dimensions are inconsistent"))
}

/// The part of `rect` inside the root window, or `None` when nothing is.
pub(crate) fn clip_to_root(rect: RootRect, root_width: u32, root_height: u32) -> Option<RootRect> {
    let left = i64::from(rect.x).max(0);
    let top = i64::from(rect.y).max(0);
    let right = (i64::from(rect.x) + i64::from(rect.width)).min(i64::from(root_width));
    let bottom = (i64::from(rect.y) + i64::from(rect.height)).min(i64::from(root_height));
    if right <= left || bottom <= top {
        return None;
    }
    Some(RootRect {
        x: i32::try_from(left).ok()?,
        y: i32::try_from(top).ok()?,
        width: u32::try_from(right - left).ok()?,
        height: u32::try_from(bottom - top).ok()?,
    })
}
