//! Pure geometry of the per-monitor-v2 regime: physical monitor and window
//! rects to global logical coordinates, the composite pixel layout at the
//! highest monitor scale, and the composite of per-monitor captures.

use image::imageops::FilterType;
use image::{Rgba, RgbaImage};
use senpi_desktop_core::ax::AxBounds;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::{FrameGeometry, MAX_COMPOSITE_PIXELS};
use senpi_desktop_core::types::{DesktopDisplay, DisplaySelector};

/// One monitor as Win32 reports it to a per-monitor-aware process: physical
/// origin and size, and the monitor's own DPI scale (1.5 at 144 DPI).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MonitorSample {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) scale: f64,
    pub(crate) is_primary: bool,
}

/// A window rect in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PhysicalRect {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// The selected monitors as logical displays ordered top-to-bottom,
/// left-to-right, each carrying its pixel rect in the composite rendered at
/// the highest monitor scale (never below 1.0). `T` travels with its sample.
pub(crate) fn lay_out<T>(
    samples: Vec<(T, MonitorSample)>,
    selector: &DisplaySelector,
) -> CoreResult<Vec<(T, DesktopDisplay)>> {
    let mut displays = Vec::with_capacity(samples.len());
    for (item, sample) in samples {
        if matches!(selector, DisplaySelector::Id(selected) if selected != &sample.id) {
            continue;
        }
        displays.push((item, logical_display(sample)?));
    }
    if displays.is_empty() {
        return Err(match selector {
            DisplaySelector::All => DesktopError::capture_failed("Win32 reported no active displays"),
            DisplaySelector::Id(id) => {
                DesktopError::invalid_target(format!("selected display id '{id}' is not active"))
            }
        });
    }
    displays.sort_by(|(_, left), (_, right)| (left.y, left.x, &left.id).cmp(&(right.y, right.x, &right.id)));
    let render_scale = displays
        .iter()
        .fold(1.0f64, |scale, (_, display)| scale.max(display.scale));
    let min_x = displays.iter().map(|(_, display)| display.x).min().unwrap_or(0);
    let min_y = displays.iter().map(|(_, display)| display.y).min().unwrap_or(0);
    for (_, display) in &mut displays {
        display.pixel_x = scaled(offset(display.x, min_x)?, render_scale);
        display.pixel_y = scaled(offset(display.y, min_y)?, render_scale);
        display.pixel_width = scaled(display.width, render_scale).max(1);
        display.pixel_height = scaled(display.height, render_scale).max(1);
    }
    let (width, height) = extent(displays.iter().map(|(_, display)| display));
    if u64::from(width) * u64::from(height) > MAX_COMPOSITE_PIXELS {
        return Err(DesktopError::capture_failed(format!(
            "Win32 composite {width}x{height} exceeds the native safety limit"
        )));
    }
    Ok(displays)
}

/// A physical window rect in global logical coordinates, divided by the scale
/// of the display holding its origin (1.0 off every display).
pub(crate) fn logical_window_rect(rect: PhysicalRect, displays: &[DesktopDisplay]) -> (i32, i32, u32, u32) {
    let scale = physical_origin_scale(rect, displays);
    (
        logical_coordinate(rect.x, scale),
        logical_coordinate(rect.y, scale),
        logical_edge(rect.width, scale),
        logical_edge(rect.height, scale),
    )
}

/// A physical rect as fractional logical bounds (UI Automation element
/// bounds), divided like [`logical_window_rect`].
pub(crate) fn logical_bounds(rect: PhysicalRect, displays: &[DesktopDisplay]) -> AxBounds {
    let scale = physical_origin_scale(rect, displays);
    AxBounds {
        x: f64::from(rect.x) / scale,
        y: f64::from(rect.y) / scale,
        width: f64::from(rect.width) / scale,
        height: f64::from(rect.height) / scale,
    }
}

/// A global logical point in physical pixels, scaled by the display holding
/// it (the first display when none does); `None` without displays.
pub(crate) fn physical_point(x: f64, y: f64, displays: &[DesktopDisplay]) -> Option<(i32, i32)> {
    let display = displays
        .iter()
        .find(|display| {
            x >= f64::from(display.x)
                && x < f64::from(display.x) + f64::from(display.width)
                && y >= f64::from(display.y)
                && y < f64::from(display.y) + f64::from(display.height)
        })
        .or_else(|| displays.first())?;
    Some((
        physical_coordinate(x, display.scale),
        physical_coordinate(y, display.scale),
    ))
}

fn physical_origin_scale(rect: PhysicalRect, displays: &[DesktopDisplay]) -> f64 {
    let (x, y) = (f64::from(rect.x), f64::from(rect.y));
    displays
        .iter()
        .find(|display| {
            let left = f64::from(display.x) * display.scale;
            let top = f64::from(display.y) * display.scale;
            x >= left
                && x < f64::from(display.width).mul_add(display.scale, left)
                && y >= top
                && y < f64::from(display.height).mul_add(display.scale, top)
        })
        .map_or(1.0, |display| display.scale)
        .max(f64::EPSILON)
}

/// Composites per-display captures at their laid-out pixel rects; a capture
/// whose size differs from its rect is resampled into it.
pub(crate) fn composite(regions: Vec<(DesktopDisplay, RgbaImage)>) -> (RgbaImage, FrameGeometry) {
    let (width, height) = extent(regions.iter().map(|(display, _)| display));
    let mut canvas = RgbaImage::from_pixel(width.max(1), height.max(1), Rgba([0, 0, 0, 255]));
    let mut displays = Vec::with_capacity(regions.len());
    for (display, image) in regions {
        let rendered = if (image.width(), image.height()) == (display.pixel_width, display.pixel_height) {
            image
        } else {
            image::imageops::resize(
                &image,
                display.pixel_width,
                display.pixel_height,
                FilterType::Triangle,
            )
        };
        image::imageops::replace(
            &mut canvas,
            &rendered,
            i64::from(display.pixel_x),
            i64::from(display.pixel_y),
        );
        displays.push(display);
    }
    (canvas, FrameGeometry::for_displays(&displays))
}

fn logical_display(sample: MonitorSample) -> CoreResult<DesktopDisplay> {
    let scale = sample.scale;
    if !scale.is_finite() || scale <= 0.0 {
        return Err(DesktopError::capture_failed(format!(
            "display '{}' has invalid scale {scale}",
            sample.id
        )));
    }
    Ok(DesktopDisplay {
        x: logical_coordinate(sample.x, scale),
        y: logical_coordinate(sample.y, scale),
        width: logical_edge(sample.width, scale),
        height: logical_edge(sample.height, scale),
        scale,
        pixel_x: 0,
        pixel_y: 0,
        pixel_width: 0,
        pixel_height: 0,
        is_primary: sample.is_primary,
        id: sample.id,
        name: sample.name,
    })
}

fn extent<'a>(displays: impl Iterator<Item = &'a DesktopDisplay>) -> (u32, u32) {
    displays.fold((0, 0), |(width, height), display| {
        (
            width.max(display.pixel_x.saturating_add(display.pixel_width)),
            height.max(display.pixel_y.saturating_add(display.pixel_height)),
        )
    })
}

fn offset(value: i32, origin: i32) -> CoreResult<u32> {
    u32::try_from(i64::from(value) - i64::from(origin))
        .map_err(|_| DesktopError::capture_failed("display offset overflow"))
}

// Float-to-int `as` saturates (NaN and negatives become 0, overflow the
// maximum): the clamp every caller wants, and the only float-to-int path.
fn logical_coordinate(physical: i32, scale: f64) -> i32 {
    (f64::from(physical) / scale).round() as i32
}

fn physical_coordinate(logical: f64, scale: f64) -> i32 {
    (logical * scale).round() as i32
}

fn logical_edge(physical: u32, scale: f64) -> u32 {
    (f64::from(physical) / scale).round().max(1.0) as u32
}

fn scaled(logical: u32, scale: f64) -> u32 {
    (f64::from(logical) * scale).round() as u32
}
