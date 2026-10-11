//! Encoders and the private artifact writer.

use std::fs::{DirBuilder, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

use image::buffer::ConvertBuffer;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder, RgbImage, RgbaImage};
use senpi_desktop_core::error::{CoreResult, DesktopError};

pub(super) const JPEG_QUALITY: u8 = 70;

pub(super) fn png(image: &RgbaImage) -> CoreResult<Vec<u8>> {
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ExtendedColorType::Rgba8,
        )
        .map_err(|error| DesktopError::capture_failed(format!("PNG encoding failed: {error}")))?;
    Ok(png)
}

/// JPEG has no alpha channel; screenshots are opaque, so it is dropped.
pub(super) fn jpeg(image: &RgbaImage) -> CoreResult<Vec<u8>> {
    let rgb: RgbImage = image.convert();
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
        .encode_image(&rgb)
        .map_err(|error| DesktopError::capture_failed(format!("JPEG encoding failed: {error}")))?;
    Ok(jpeg)
}

/// Writes `png` to a new owner-only `senpi-computer-<ulid>.png` in `dir`.
pub(super) fn write_artifact(dir: &Path, png: &[u8]) -> CoreResult<PathBuf> {
    let failed = |what: &str, path: &Path, error: std::io::Error| {
        DesktopError::capture_failed(format!(
            "cannot {what} screenshot artifact {}: {error}",
            path.display()
        ))
    };
    let mut dirs = DirBuilder::new();
    dirs.recursive(true);
    #[cfg(unix)]
    dirs.mode(0o700);
    dirs.create(dir)
        .map_err(|error| failed("create the directory of", dir, error))?;
    let path = dir.join(format!("senpi-computer-{}.png", ulid::Ulid::generate()));
    let mut file = OpenOptions::new();
    file.write(true).create_new(true);
    #[cfg(unix)]
    file.mode(0o600);
    file.open(&path)
        .and_then(|mut file| file.write_all(png))
        .map_err(|error| failed("write", &path, error))?;
    Ok(path)
}

/// `bytes` for people: `N bytes`, whole KiB, or MiB to one decimal.
pub(super) fn format_bytes(bytes: u64) -> String {
    const KIB: u128 = 1024;
    const MIB: u128 = KIB * KIB;
    let bytes = u128::from(bytes);
    if bytes < KIB {
        return format!("{bytes} bytes");
    }
    if bytes < MIB {
        return format!("{} KiB", (bytes + KIB / 2) / KIB);
    }
    let tenths = (bytes * 10 + MIB / 2) / MIB;
    format!("{}.{} MiB", tenths / 10, tenths % 10)
}
