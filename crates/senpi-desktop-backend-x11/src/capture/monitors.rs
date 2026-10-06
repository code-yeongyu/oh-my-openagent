//! RandR monitors -> `DesktopDisplay`s laid out in one composite pixel space.

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{DesktopDisplay, DisplaySelector};

use super::connection::{Monitor, Screen, XServer};

/// Active monitors (the whole root screen when RandR reports none), filtered
/// by the selector (id or name), with `pixel_x/pixel_y` relative to the
/// top-left of the selected set. X11 has no per-monitor scale: `scale = 1`.
pub(crate) fn displays(server: &impl XServer, selector: &DisplaySelector) -> CoreResult<Vec<DesktopDisplay>> {
    let mut displays: Vec<DesktopDisplay> = server.monitors()?.into_iter().map(from_monitor).collect();
    if displays.is_empty() {
        displays.push(root_display(server.screen()));
    }
    let mut selected: Vec<DesktopDisplay> = match selector {
        DisplaySelector::All => displays,
        DisplaySelector::Id(wanted) => displays
            .into_iter()
            .filter(|display| display.id == *wanted || display.name == *wanted)
            .collect(),
    };
    let (Some(min_x), Some(min_y)) = (
        selected.iter().map(|display| display.x).min(),
        selected.iter().map(|display| display.y).min(),
    ) else {
        return Err(DesktopError::capture_failed(
            "configured X11 display was not found",
        ));
    };
    for display in &mut selected {
        display.pixel_x = offset(display.x, min_x)?;
        display.pixel_y = offset(display.y, min_y)?;
    }
    Ok(selected)
}

fn offset(value: i32, min: i32) -> CoreResult<u32> {
    u32::try_from(i64::from(value) - i64::from(min))
        .map_err(|_| DesktopError::capture_failed("X11 monitor layout exceeds composite coordinate space"))
}

fn from_monitor(monitor: Monitor) -> DesktopDisplay {
    DesktopDisplay {
        id: monitor.atom.to_string(),
        name: monitor.name,
        x: i32::from(monitor.x),
        y: i32::from(monitor.y),
        width: u32::from(monitor.width),
        height: u32::from(monitor.height),
        scale: 1.0,
        pixel_x: 0,
        pixel_y: 0,
        pixel_width: u32::from(monitor.width),
        pixel_height: u32::from(monitor.height),
        is_primary: monitor.primary,
    }
}

fn root_display(screen: Screen) -> DesktopDisplay {
    DesktopDisplay {
        id: "0".into(),
        name: "Screen".into(),
        x: 0,
        y: 0,
        width: screen.width,
        height: screen.height,
        scale: 1.0,
        pixel_x: 0,
        pixel_y: 0,
        pixel_width: screen.width,
        pixel_height: screen.height,
        is_primary: true,
    }
}
