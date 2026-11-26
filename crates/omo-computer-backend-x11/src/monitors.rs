//! RandR monitors and their real scale: `Xft.dpi` from the root `RESOURCE_MANAGER` first,
//! then `GDK_SCALE`, then the RandR physical size (dpi / 96 rounded to 0.25), then 1.0
//! marked assumed. No scale is taken as 1.0 silently.

use crate::capture::server::{Monitor, PixelRect, XError, XServer};

pub const BASE_DPI: f64 = 96.0;
const MM_PER_INCH: f64 = 25.4;

/// Where a monitor's scale came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScaleSource {
    XftDpi,
    GdkScale,
    RandrMm,
    Assumed,
}

/// One monitor with the scale the capture maps it through.
#[derive(Debug, Clone, PartialEq)]
pub struct MonitorReading {
    pub monitor: Monitor,
    pub scale: f64,
    pub source: ScaleSource,
}

/// The `Xft.dpi` value of a `RESOURCE_MANAGER` string.
#[must_use]
pub fn xft_dpi(resources: &str) -> Option<f64> {
    resources
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.trim() == "Xft.dpi" {
                value.trim().parse::<f64>().ok()
            } else {
                None
            }
        })
        .filter(|dpi| dpi.is_finite() && *dpi > 0.0)
}

fn gdk_scale(value: Option<&str>) -> Option<f64> {
    value?
        .trim()
        .parse::<u32>()
        .ok()
        .filter(|scale| *scale >= 1)
        .map(f64::from)
}

fn quarter(value: f64) -> f64 {
    (value * 4.0).round() / 4.0
}

fn physical_scale(monitor: &Monitor) -> Option<f64> {
    if monitor.width_mm == 0 || monitor.rect.width == 0 {
        return None;
    }
    let dpi = f64::from(monitor.rect.width) * MM_PER_INCH / f64::from(monitor.width_mm);
    let scale = quarter(dpi / BASE_DPI);
    (scale.is_finite() && scale > 0.0).then_some(scale)
}

/// The scale of `monitor` and its source.
#[must_use]
pub fn scale_of(monitor: &Monitor, resources: Option<&str>, gdk: Option<&str>) -> (f64, ScaleSource) {
    if let Some(dpi) = resources.and_then(xft_dpi) {
        return (dpi / BASE_DPI, ScaleSource::XftDpi);
    }
    if let Some(scale) = gdk_scale(gdk) {
        return (scale, ScaleSource::GdkScale);
    }
    if let Some(scale) = physical_scale(monitor) {
        return (scale, ScaleSource::RandrMm);
    }
    (1.0, ScaleSource::Assumed)
}

fn whole_screen(server: &impl XServer) -> Monitor {
    let screen = server.screen();
    Monitor {
        atom: 0,
        name: "screen".to_owned(),
        primary: true,
        rect: PixelRect {
            x: 0,
            y: 0,
            width: screen.width,
            height: screen.height,
        },
        width_mm: screen.width_mm,
        height_mm: screen.height_mm,
    }
}

/// Every active monitor (the whole root screen when RandR reports none) with its scale.
///
/// # Errors
/// A RandR or property read failed.
pub fn read(server: &impl XServer, gdk: Option<&str>) -> Result<Vec<MonitorReading>, XError> {
    let mut monitors = server.monitors()?;
    if monitors.is_empty() {
        monitors.push(whole_screen(server));
    }
    let resources = server.resource_manager()?;
    Ok(monitors
        .into_iter()
        .map(|monitor| {
            let (scale, source) = scale_of(&monitor, resources.as_deref(), gdk);
            MonitorReading {
                monitor,
                scale,
                source,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(width: u32, width_mm: u32) -> Monitor {
        Monitor {
            atom: 1,
            name: "DP-1".to_owned(),
            primary: true,
            rect: PixelRect {
                x: 0,
                y: 0,
                width,
                height: 1080,
            },
            width_mm,
            height_mm: 300,
        }
    }

    #[test]
    fn randr_scale_from_xft_dpi() {
        let resources = "Xcursor.size:\t24\nXft.dpi:\t144\nXft.antialias:\t1\n";
        let (scale, source) = scale_of(&monitor(1920, 508), Some(resources), Some("3"));
        assert!((scale - 1.5).abs() < f64::EPSILON);
        assert_eq!(source, ScaleSource::XftDpi);
    }

    #[test]
    fn xft_dpi_192_reports_scale_2() {
        let (scale, source) = scale_of(&monitor(1920, 508), Some("Xft.dpi: 192\n"), None);
        assert!((scale - 2.0).abs() < f64::EPSILON);
        assert_eq!(source, ScaleSource::XftDpi);
    }

    #[test]
    fn gdk_scale_then_physical_size_then_assumed() {
        let (scale, source) = scale_of(&monitor(1920, 508), Some("Xcursor.size: 24\n"), Some("2"));
        assert_eq!((scale, source), (2.0, ScaleSource::GdkScale));
        let (scale, source) = scale_of(&monitor(3840, 344), None, Some("0"));
        assert_eq!((scale, source), (3.0, ScaleSource::RandrMm));
        let (scale, source) = scale_of(&monitor(1920, 0), None, None);
        assert_eq!((scale, source), (1.0, ScaleSource::Assumed));
    }

    #[test]
    fn physical_dpi_rounds_to_a_quarter() {
        let (scale, source) = scale_of(&monitor(2560, 527), None, None);
        assert_eq!((scale, source), (1.25, ScaleSource::RandrMm));
    }
}
