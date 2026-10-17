use image::RgbaImage;

use super::pod::{Negotiated, VideoFormat};

/// Converts one mapped PipeWire frame (`bytes`, rows `stride` apart) into
/// RGBA (oh-my-pi `rgba_from_buffer`).
pub fn to_rgba(format: Negotiated, bytes: &[u8], stride: usize) -> Result<RgbaImage, String> {
    let (width, height) = (format.width as usize, format.height as usize);
    let pixel = format.format.bytes_per_pixel();
    let row = width.checked_mul(pixel).ok_or("PipeWire row size overflow")?;
    let needed = stride.checked_mul(height).ok_or("PipeWire frame size overflow")?;
    if stride < row || bytes.len() < needed {
        return Err(format!(
            "PipeWire frame buffer is short: {} bytes for {width}x{height} stride {stride}",
            bytes.len()
        ));
    }
    let mut rgba = Vec::with_capacity(width * height * 4);
    for line in bytes.chunks(stride).take(height) {
        for input in line[..row].chunks_exact(pixel) {
            let alpha = if pixel == 4 { input[3] } else { 255 };
            match format.format {
                VideoFormat::Rgbx | VideoFormat::Rgb => {
                    rgba.extend_from_slice(&[input[0], input[1], input[2], 255])
                }
                VideoFormat::Rgba => rgba.extend_from_slice(&[input[0], input[1], input[2], alpha]),
                VideoFormat::Bgrx | VideoFormat::Bgr => {
                    rgba.extend_from_slice(&[input[2], input[1], input[0], 255])
                }
                VideoFormat::Bgra => rgba.extend_from_slice(&[input[2], input[1], input[0], alpha]),
            }
        }
    }
    RgbaImage::from_raw(format.width, format.height, rgba)
        .ok_or_else(|| "PipeWire RGBA frame size mismatch".to_owned())
}
