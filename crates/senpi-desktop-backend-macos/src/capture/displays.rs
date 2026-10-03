//! Display enumeration through `xcap::Monitor` and the multi-display
//! composite of per-display `screencapture` images.

use image::imageops::FilterType;
use image::{Rgba, RgbaImage};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::{FrameGeometry, MAX_COMPOSITE_PIXELS};
use senpi_desktop_core::types::{DesktopDisplay, DisplaySelector};
use xcap::Monitor;

/// Active displays matching `selector`, ordered top-to-bottom, left-to-right.
pub(crate) fn enumerate(selector: &DisplaySelector) -> CoreResult<Vec<DesktopDisplay>> {
    let monitors = Monitor::all().map_err(|error| {
        DesktopError::capture_failed(format!("Quartz monitor enumeration failed: {error}"))
    })?;
    let mut displays = Vec::with_capacity(monitors.len());
    for monitor in monitors {
        let id = monitor.id().map_err(metadata_error)?.to_string();
        if matches!(selector, DisplaySelector::Id(selected) if selected != &id) {
            continue;
        }
        let width = monitor.width().map_err(metadata_error)?;
        let height = monitor.height().map_err(metadata_error)?;
        let scale = f64::from(monitor.scale_factor().map_err(metadata_error)?);
        // xcap's friendly_name is NSScreen.localizedName(); the model name is
        // the fallback.
        let name = monitor
            .friendly_name()
            .or_else(|_| monitor.name())
            .unwrap_or_else(|_| format!("Display {id}"));
        displays.push(DesktopDisplay {
            name,
            x: monitor.x().map_err(metadata_error)?,
            y: monitor.y().map_err(metadata_error)?,
            width,
            height,
            scale,
            pixel_x: 0,
            pixel_y: 0,
            pixel_width: scaled_edge(width, scale),
            pixel_height: scaled_edge(height, scale),
            is_primary: monitor.is_primary().map_err(metadata_error)?,
            id,
        });
    }
    if displays.is_empty() {
        return Err(match selector {
            DisplaySelector::All => DesktopError::capture_failed("Quartz reported no active displays"),
            DisplaySelector::Id(id) => {
                DesktopError::invalid_target(format!("selected display id '{id}' is not active"))
            }
        });
    }
    displays.sort_by(|left, right| (left.y, left.x, &left.id).cmp(&(right.y, right.x, &right.id)));
    Ok(displays)
}

/// Composites per-display captures into one image at the highest observed
/// render scale and records each display's pixel rect in the composite.
pub(crate) fn composite(regions: Vec<(DesktopDisplay, RgbaImage)>) -> CoreResult<(RgbaImage, FrameGeometry)> {
    let render_scale = regions.iter().fold(1.0f64, |scale, (display, image)| {
        scale
            .max(f64::from(image.width()) / f64::from(display.width.max(1)))
            .max(f64::from(image.height()) / f64::from(display.height.max(1)))
    });
    let bounds = |edge: fn(&DesktopDisplay) -> i64| regions.iter().map(move |(display, _)| edge(display));
    let min_x = bounds(|d| i64::from(d.x)).min().unwrap_or(0);
    let min_y = bounds(|d| i64::from(d.y)).min().unwrap_or(0);
    let max_x = bounds(|d| i64::from(d.x) + i64::from(d.width)).max().unwrap_or(0);
    let max_y = bounds(|d| i64::from(d.y) + i64::from(d.height))
        .max()
        .unwrap_or(0);
    let logical_width = u32::try_from(max_x - min_x)
        .map_err(|_| DesktopError::capture_failed("desktop logical width overflow"))?;
    let logical_height = u32::try_from(max_y - min_y)
        .map_err(|_| DesktopError::capture_failed("desktop logical height overflow"))?;
    let target_width = scaled_edge(logical_width, render_scale).max(1);
    let target_height = scaled_edge(logical_height, render_scale).max(1);
    if u64::from(target_width) * u64::from(target_height) > MAX_COMPOSITE_PIXELS {
        return Err(DesktopError::capture_failed(format!(
            "composite {target_width}x{target_height} exceeds the native safety limit",
        )));
    }
    let mut canvas = RgbaImage::from_pixel(target_width, target_height, Rgba([0, 0, 0, 255]));
    let mut metadata = Vec::with_capacity(regions.len());
    for (mut display, image) in regions {
        let offset_x = u32::try_from(i64::from(display.x) - min_x)
            .map_err(|_| DesktopError::capture_failed("display x offset overflow"))?;
        let offset_y = u32::try_from(i64::from(display.y) - min_y)
            .map_err(|_| DesktopError::capture_failed("display y offset overflow"))?;
        display.pixel_x = scaled_edge(offset_x, render_scale);
        display.pixel_y = scaled_edge(offset_y, render_scale);
        display.pixel_width = scaled_edge(display.width, render_scale).max(1);
        display.pixel_height = scaled_edge(display.height, render_scale).max(1);
        let rendered = if image.width() == display.pixel_width && image.height() == display.pixel_height {
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
        metadata.push(display);
    }
    Ok((canvas, FrameGeometry::for_displays(&metadata)))
}

fn metadata_error(error: impl std::fmt::Display) -> DesktopError {
    DesktopError::capture_failed(format!("failed to read native display metadata: {error}"))
}

/// Logical edge times scale, rounded. Float-to-int `as` saturates (negative
/// and NaN become 0, overflow becomes `u32::MAX`), the clamp every caller wants.
pub(crate) fn scaled_edge(value: u32, scale: f64) -> u32 {
    (f64::from(value) * scale).round() as u32
}
