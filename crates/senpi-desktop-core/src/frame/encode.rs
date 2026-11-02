use std::io::Cursor;

use image::{DynamicImage, ImageFormat, RgbaImage};

use crate::error::{CoreResult, DesktopError};

pub fn encode_png(image: RgbaImage) -> CoreResult<Vec<u8>> {
    let mut png = Vec::with_capacity(image.len() / 2);
    DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|error| DesktopError::capture_failed(format!("PNG encoding failed: {error}")))?;
    Ok(png)
}
