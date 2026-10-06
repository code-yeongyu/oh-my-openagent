//! Pure geometry of the per-monitor-v2 regime. Win32 capture, window, AX and
//! input coordinates stay in physical desktop pixels end-to-end; monitor DPI
//! scale is metadata, never a transform of the global atlas.

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

/// The selected monitors ordered top-to-bottom, left-to-right in physical
/// desktop coordinates. `T` travels with its sample.
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
    let min_x = displays.iter().map(|(_, display)| display.x).min().unwrap_or(0);
    let min_y = displays.iter().map(|(_, display)| display.y).min().unwrap_or(0);
    for (_, display) in &mut displays {
        display.pixel_x = offset(display.x, min_x)?;
        display.pixel_y = offset(display.y, min_y)?;
        display.pixel_width = display.width;
        display.pixel_height = display.height;
    }
    let (width, height) = extent(displays.iter().map(|(_, display)| display));
    if u64::from(width) * u64::from(height) > MAX_COMPOSITE_PIXELS {
        return Err(DesktopError::capture_failed(format!(
            "Win32 composite {width}x{height} exceeds the native safety limit"
        )));
    }
    Ok(displays)
}

/// A physical window rect in the same global physical coordinates.
pub(crate) fn logical_window_rect(rect: PhysicalRect, displays: &[DesktopDisplay]) -> (i32, i32, u32, u32) {
    let _ = displays;
    (rect.x, rect.y, rect.width, rect.height)
}

/// A physical rect as fractional AX bounds in physical desktop pixels.
pub(crate) fn logical_bounds(rect: PhysicalRect, displays: &[DesktopDisplay]) -> AxBounds {
    let _ = displays;
    AxBounds {
        x: f64::from(rect.x),
        y: f64::from(rect.y),
        width: f64::from(rect.width),
        height: f64::from(rect.height),
    }
}

/// A global physical point, rejected when it falls outside every display.
pub(crate) fn physical_point(x: f64, y: f64, displays: &[DesktopDisplay]) -> Option<(i32, i32)> {
    x.is_finite()
        .then_some(())
        .and(y.is_finite().then_some(()))
        .and_then(|()| {
            displays
                .iter()
                .any(|display| {
                    x >= f64::from(display.x)
                        && x < f64::from(display.x) + f64::from(display.width)
                        && y >= f64::from(display.y)
                        && y < f64::from(display.y) + f64::from(display.height)
                })
                .then(|| (x.round() as i32, y.round() as i32))
        })
}

/// Composites per-display captures only when each still matches the geometry
/// enumerated before capture.
pub(crate) fn composite(regions: Vec<(DesktopDisplay, RgbaImage)>) -> CoreResult<(RgbaImage, FrameGeometry)> {
    let (width, height) = extent(regions.iter().map(|(display, _)| display));
    let mut canvas = RgbaImage::from_pixel(width.max(1), height.max(1), Rgba([0, 0, 0, 255]));
    let mut displays = Vec::with_capacity(regions.len());
    for (display, image) in regions {
        if !capture_geometry_matches(&display, &image) {
            return Err(DesktopError::capture_failed(format!(
                "display '{}' geometry changed during capture: expected {}x{}, got {}x{}",
                display.id,
                display.pixel_width,
                display.pixel_height,
                image.width(),
                image.height()
            )));
        }
        image::imageops::replace(
            &mut canvas,
            &image,
            i64::from(display.pixel_x),
            i64::from(display.pixel_y),
        );
        displays.push(display);
    }
    Ok((canvas, FrameGeometry::for_displays(&displays)))
}

pub(crate) fn capture_geometry_matches(display: &DesktopDisplay, image: &RgbaImage) -> bool {
    (image.width(), image.height()) == (display.pixel_width, display.pixel_height)
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
        x: sample.x,
        y: sample.y,
        width: sample.width,
        height: sample.height,
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
