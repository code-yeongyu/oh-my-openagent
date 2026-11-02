use image::RgbaImage;

use super::{FrameGeometry, FrameKind};
use crate::error::{CoreResult, DesktopError};
use crate::frame::round_to_u32;
use crate::types::{CaptureRegion, DesktopDisplay, DesktopWindow, Target};

impl FrameGeometry {
    pub const fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// Desktop zoom recaptures the displays of the full frame, not new focus.
    pub fn capture_target(&self, target: &Target) -> Target {
        match (&self.kind, self.regions.as_slice()) {
            (FrameKind::Desktop, [region]) => Target::parse(&format!("display:{}", region.id)),
            (FrameKind::Desktop, _) => Target::parse("display:all"),
            _ => target.clone(),
        }
    }

    pub fn validate_region(&self, region: &CaptureRegion) -> CoreResult<()> {
        self.refuse_pixels_only()?;
        let right = region.x + region.width;
        let bottom = region.y + region.height;
        if ![
            region.x,
            region.y,
            region.width,
            region.height,
            right,
            bottom,
        ]
        .into_iter()
        .all(f64::is_finite)
            || region.x < 0.0
            || region.y < 0.0
            || region.width <= 0.0
            || region.height <= 0.0
            || right <= region.x
            || bottom <= region.y
            || right > f64::from(self.width)
            || bottom > f64::from(self.height)
        {
            return Err(DesktopError::invalid_coordinate_frame(
                "zoom must be a finite positive rectangle inside the last full screenshot",
            ));
        }
        Ok(())
    }

    /// Refuses stale desktop layout or window size before native capture.
    pub fn validate_zoom_layout(
        &self,
        displays: &[DesktopDisplay],
        window: Option<&DesktopWindow>,
    ) -> CoreResult<()> {
        let same = |a: f64, b: f64| (a - b).abs() < f64::EPSILON;
        let valid = match self.kind {
            FrameKind::Desktop => {
                (self.regions.len() == 1 || self.regions.len() == displays.len())
                    && self.regions.iter().all(|region| {
                        displays.iter().any(|display| {
                            display.id == region.id
                                && same(f64::from(display.x), region.x)
                                && same(f64::from(display.y), region.y)
                                && same(f64::from(display.width), region.width)
                                && same(f64::from(display.height), region.height)
                                && same(display.scale, region.scale)
                        })
                    })
            }
            FrameKind::Window {
                captured_width,
                captured_height,
                ..
            } => window.is_some_and(|window| {
                window.width == captured_width && window.height == captured_height
            }),
            FrameKind::Identity | FrameKind::PixelsOnly { .. } => false,
        };
        if valid {
            Ok(())
        } else {
            Err(stale())
        }
    }

    /// Maps the full screenshot rectangle into compatible fresh native pixels.
    pub fn crop_region(
        &self,
        image: RgbaImage,
        fresh: &Self,
        region: &CaptureRegion,
    ) -> CoreResult<RgbaImage> {
        self.validate_region(region)?;
        let ratio_x = f64::from(fresh.width) / f64::from(self.width);
        let ratio_y = f64::from(fresh.height) / f64::from(self.height);
        let same = |a: f64, b: f64| (a - b).abs() < f64::EPSILON;
        let compatible = self.kind == fresh.kind
            && self.regions.len() == fresh.regions.len()
            && self
                .regions
                .iter()
                .zip(&fresh.regions)
                .all(|(base, current)| {
                    base.id == current.id
                        && same(base.width, current.width)
                        && same(base.height, current.height)
                        && (self.kind != FrameKind::Desktop
                            || (same(base.x, current.x)
                                && same(base.y, current.y)
                                && same(base.scale, current.scale)))
                        && base.pixel_x.mul_add(ratio_x, -current.pixel_x).abs() < 0.5
                        && base.pixel_y.mul_add(ratio_y, -current.pixel_y).abs() < 0.5
                        && base
                            .pixel_width
                            .mul_add(ratio_x, -current.pixel_width)
                            .abs()
                            < 0.5
                        && base
                            .pixel_height
                            .mul_add(ratio_y, -current.pixel_height)
                            .abs()
                            < 0.5
                });
        if !compatible
            || image.dimensions() != fresh.dimensions()
            || image.width() == 0
            || image.height() == 0
        {
            return Err(stale());
        }
        let left = round_to_u32((region.x * ratio_x).floor());
        let top = round_to_u32((region.y * ratio_y).floor());
        let right = round_to_u32(((region.x + region.width) * ratio_x).ceil()).min(image.width());
        let bottom =
            round_to_u32(((region.y + region.height) * ratio_y).ceil()).min(image.height());
        if right <= left || bottom <= top {
            return Err(DesktopError::invalid_coordinate_frame(
                "zoom contains no native pixels",
            ));
        }
        Ok(image::imageops::crop_imm(&image, left, top, right - left, bottom - top).to_image())
    }
}

fn stale() -> DesktopError {
    DesktopError::invalid_coordinate_frame(
        "capture geometry changed; take a new full screenshot before zoom",
    )
}

#[cfg(test)]
mod tests;
