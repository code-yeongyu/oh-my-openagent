//! Logical geometry for capture pixels that arrived without it: the
//! Screenshot-portal fallback image, and a ScreenCast stream that reported
//! no logical size. The connected libei session's absolute-pointer regions
//! are the compositor's own statement of the logical layout (and per-region
//! scale) that input coordinates use, so they decide the mapping. An image
//! is accepted only when it is exactly that layout at one uniform scale;
//! anything else leaves the geometry unknown and the frame pixels-only.

use senpi_desktop_core::types::DesktopDisplay;

pub use super::eis_region::EisRegion;

/// Scales two regions may differ by and still be one scale (f32 on the wire).
const SCALE_EPSILON: f64 = 1e-3;
/// Pixels an image axis may differ from the scaled layout (rounding).
const ROUNDING_PX: f64 = 1.0;
/// Candidate scales for a single region that reported none (cua-driver's
/// macOS frame check: only exact 1x or 2x).
const UNSET_SCALE_CANDIDATES: [f64; 2] = [1.0, 2.0];

struct Bounds {
    x: u64,
    y: u64,
    width: u64,
    height: u64,
}

fn bounds(regions: &[EisRegion]) -> Option<Bounds> {
    let x = regions.iter().map(|r| u64::from(r.x)).min()?;
    let y = regions.iter().map(|r| u64::from(r.y)).min()?;
    let right = regions.iter().map(EisRegion::right).max()?;
    let bottom = regions.iter().map(EisRegion::bottom).max()?;
    Some(Bounds {
        x,
        y,
        width: right - x,
        height: bottom - y,
    })
}

/// The scales an image of these regions may have been taken at: logical
/// size, and the one scale every region reports (or 2x for one unset region).
fn candidate_scales(regions: &[EisRegion]) -> Option<Vec<f64>> {
    let reported: Vec<Option<f64>> = regions.iter().map(EisRegion::reported_scale).collect();
    if reported.iter().all(Option::is_none) {
        return (regions.len() == 1).then(|| UNSET_SCALE_CANDIDATES.to_vec());
    }
    let first = reported.first().copied().flatten()?;
    let uniform = reported
        .iter()
        .all(|scale| scale.is_some_and(|scale| (scale - first).abs() <= SCALE_EPSILON));
    uniform.then(|| vec![1.0, first])
}

fn usable(regions: &[EisRegion]) -> bool {
    !regions.is_empty()
        && regions.iter().all(|r| r.width > 0 && r.height > 0 && !r.scale.is_nan())
        && regions
            .iter()
            .enumerate()
            .all(|(index, region)| regions[index + 1..].iter().all(|other| !region.overlaps(other)))
}

fn close(pixels: u32, logical: u64, scale: f64) -> bool {
    #[expect(
        clippy::cast_precision_loss,
        reason = "logical extents are u32 sums, far below f64's exact-integer range"
    )]
    let expected = logical as f64 * scale;
    (f64::from(pixels) - expected).abs() <= ROUNDING_PX
}

fn pixel(offset: u64, ratio: f64) -> Option<u32> {
    #[expect(
        clippy::cast_precision_loss,
        reason = "logical offsets are u32 sums, far below f64's exact-integer range"
    )]
    let pixels = (offset as f64 * ratio).round();
    if !(0.0..=f64::from(u32::MAX)).contains(&pixels) {
        return None;
    }
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "rounded and range-checked against u32 above"
    )]
    let pixels = pixels as u32;
    Some(pixels)
}

/// Displays for a `width` x `height` image of the whole `regions` layout,
/// ids `{id_prefix}{index}`, or `None` when the image is not that layout.
pub fn derive_displays(
    width: u32,
    height: u32,
    regions: &[EisRegion],
    id_prefix: &str,
    name: &str,
) -> Option<Vec<DesktopDisplay>> {
    if width == 0 || height == 0 || !usable(regions) {
        return None;
    }
    let bounds = bounds(regions)?;
    let scale = candidate_scales(regions)?
        .into_iter()
        .find(|&scale| close(width, bounds.width, scale) && close(height, bounds.height, scale))?;
    #[expect(
        clippy::cast_precision_loss,
        reason = "logical extents are u32 sums, far below f64's exact-integer range"
    )]
    let (ratio_x, ratio_y) = (
        f64::from(width) / bounds.width as f64,
        f64::from(height) / bounds.height as f64,
    );
    regions
        .iter()
        .enumerate()
        .map(|(index, region)| {
            let pixel_x = pixel(u64::from(region.x) - bounds.x, ratio_x)?;
            let pixel_y = pixel(u64::from(region.y) - bounds.y, ratio_y)?;
            let pixel_right = pixel(region.right() - bounds.x, ratio_x)?;
            let pixel_bottom = pixel(region.bottom() - bounds.y, ratio_y)?;
            Some(DesktopDisplay {
                id: format!("{id_prefix}{index}"),
                name: format!("{name} {index}"),
                x: i32::try_from(region.x).ok()?,
                y: i32::try_from(region.y).ok()?,
                width: region.width,
                height: region.height,
                scale,
                pixel_x,
                pixel_y,
                pixel_width: pixel_right.checked_sub(pixel_x).filter(|&w| w > 0)?,
                pixel_height: pixel_bottom.checked_sub(pixel_y).filter(|&h| h > 0)?,
                is_primary: index == 0,
            })
        })
        .collect()
}

/// Logical size of one ScreenCast monitor stream that reported none: the
/// single region at the monitor's logical `position`, accepted only when
/// the `width` x `height` frame is that region at one scale.
pub fn monitor_size(position: (i32, i32), width: u32, height: u32, regions: &[EisRegion]) -> Option<(u32, u32)> {
    let (x, y) = (u32::try_from(position.0).ok()?, u32::try_from(position.1).ok()?);
    let mut at_position = regions.iter().filter(|region| region.x == x && region.y == y);
    let region = *at_position.next()?;
    if at_position.next().is_some() {
        return None;
    }
    derive_displays(width, height, &[region], "", "")?;
    Some((region.width, region.height))
}
