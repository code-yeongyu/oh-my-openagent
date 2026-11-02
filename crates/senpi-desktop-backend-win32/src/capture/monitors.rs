//! Display enumeration through `xcap::Monitor` (GDI; never DXGI).

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{DesktopDisplay, DisplaySelector};
use xcap::Monitor;

use super::frame::{lay_out, MonitorSample};

/// The monitors matching `selector`, each with its laid-out logical display.
pub(crate) fn read(selector: &DisplaySelector) -> CoreResult<Vec<(Monitor, DesktopDisplay)>> {
    let monitors = Monitor::all().map_err(|error| metadata_error("display enumeration", error))?;
    let samples = monitors
        .into_iter()
        .map(|monitor| sample(&monitor).map(|sample| (monitor, sample)))
        .collect::<CoreResult<Vec<_>>>()?;
    lay_out(samples, selector)
}

fn sample(monitor: &Monitor) -> CoreResult<MonitorSample> {
    let id = monitor
        .id()
        .map_err(|error| metadata_error("display id", error))?
        .to_string();
    Ok(MonitorSample {
        name: monitor
            .friendly_name()
            .or_else(|_| monitor.name())
            .unwrap_or_else(|_| format!("Display {id}")),
        x: monitor.x().map_err(|error| metadata_error("display x", error))?,
        y: monitor.y().map_err(|error| metadata_error("display y", error))?,
        width: monitor
            .width()
            .map_err(|error| metadata_error("display width", error))?,
        height: monitor
            .height()
            .map_err(|error| metadata_error("display height", error))?,
        scale: f64::from(
            monitor
                .scale_factor()
                .map_err(|error| metadata_error("display scale", error))?,
        ),
        is_primary: monitor
            .is_primary()
            .map_err(|error| metadata_error("primary display", error))?,
        id,
    })
}

fn metadata_error(what: &str, error: impl std::fmt::Display) -> DesktopError {
    DesktopError::capture_failed(format!("Win32 {what} query failed: {error}"))
}
