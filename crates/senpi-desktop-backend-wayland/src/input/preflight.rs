use reis::event::DeviceCapability;
use senpi_desktop_core::backend::{Modifiers, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::EiDevice;

pub(super) struct PointerAdmission {
    pub pointer: usize,
    pub keyboard: Option<usize>,
    pub scroll: Option<(i32, i32)>,
}

pub(super) fn pointer(devices: &[EiDevice], event: &PointerEvent) -> CoreResult<PointerAdmission> {
    let modifiers = modifiers(event);
    let needs_button = matches!(
        event,
        PointerEvent::Click { .. } | PointerEvent::Drag { .. }
    );
    let scroll = match event {
        PointerEvent::Scroll { dx, dy, .. } => Some((scroll_units(*dx)?, scroll_units(*dy)?)),
        PointerEvent::Click { .. } | PointerEvent::Move { .. } | PointerEvent::Drag { .. } => None,
    };
    if matches!(event, PointerEvent::Drag { path, .. } if path.is_empty()) {
        return Err(DesktopError::input_failed("libei drag path is empty"));
    }
    let pointer = devices
        .iter()
        .position(|device| {
            device.resumed
                && device
                    .device
                    .has_capability(DeviceCapability::PointerAbsolute)
                && (!needs_button || device.device.has_capability(DeviceCapability::Button))
                && (scroll.is_none() || device.device.has_capability(DeviceCapability::Scroll))
                && covers_event(device, event)
        })
        .ok_or_else(|| {
            DesktopError::input_failed(
                "no resumed libei pointer provides the required capabilities and covers every \
                 gesture point; no input was sent",
            )
        })?;
    let keyboard = if modifiers == Modifiers::default() {
        None
    } else {
        Some(
            devices
                .iter()
                .position(|keyboard| {
                    keyboard.resumed
                        && keyboard.device.seat() == devices[pointer].device.seat()
                        && keyboard.device.has_capability(DeviceCapability::Keyboard)
                })
                .ok_or_else(|| {
                    DesktopError::permission_denied(
                        "no resumed libei keyboard on the pointer's seat can hold the gesture's \
                         modifiers",
                    )
                })?,
        )
    };
    Ok(PointerAdmission {
        pointer,
        keyboard,
        scroll,
    })
}

fn modifiers(event: &PointerEvent) -> Modifiers {
    match event {
        PointerEvent::Click { modifiers, .. } | PointerEvent::Drag { modifiers, .. } => *modifiers,
        PointerEvent::Move { .. } | PointerEvent::Scroll { .. } => Modifiers::default(),
    }
}

fn covers_event(device: &EiDevice, event: &PointerEvent) -> bool {
    match event {
        PointerEvent::Click { x, y, .. }
        | PointerEvent::Move { x, y }
        | PointerEvent::Scroll { x, y, .. } => contains(device, *x, *y),
        PointerEvent::Drag { path, .. } => path.iter().all(|&(x, y)| contains(device, x, y)),
    }
}

fn contains(device: &EiDevice, x: f64, y: f64) -> bool {
    x.is_finite()
        && y.is_finite()
        && device.device.regions().iter().any(|region| {
            x >= f64::from(region.x)
                && y >= f64::from(region.y)
                && x < f64::from(region.x.saturating_add(region.width))
                && y < f64::from(region.y.saturating_add(region.height))
        })
}

/// libei discrete scroll counts 120ths of a wheel click; scroll deltas are
/// pixels on every OS and one click stands for about 40 of them.
const DISCRETE_UNITS_PER_PIXEL: f64 = 120.0 / 40.0;

/// A pixel delta in 120ths of a wheel click, rounded; any motion stays at
/// least one unit so a tiny delta is never silently dropped.
fn scroll_units(value: f64) -> CoreResult<i32> {
    let mut units = (value * DISCRETE_UNITS_PER_PIXEL).round();
    if units.abs() < 1.0 && value.abs() > 0.0 {
        units = value.signum();
    }
    if !units.is_finite() || units < f64::from(i32::MIN) || units > f64::from(i32::MAX) {
        return Err(DesktopError::input_failed(format!(
            "scroll delta {value} is out of range"
        )));
    }
    #[expect(
        clippy::cast_possible_truncation,
        reason = "the finite i32 bounds check above proves this conversion"
    )]
    let units = units as i32;
    Ok(units)
}

#[cfg(test)]
mod tests {
    use super::scroll_units;

    #[test]
    fn scroll_pixels_become_120ths_of_a_forty_pixel_click() {
        let units: Vec<i32> = [0.0, 40.0, -40.0, 120.0, 1.0, 0.1, -0.1, 0.5, -80.0]
            .into_iter()
            .map(|pixels| scroll_units(pixels).unwrap())
            .collect();

        assert_eq!(units, [0, 120, -120, 360, 3, 1, -1, 2, -240]);
    }

    #[test]
    fn scroll_pixels_outside_the_wire_range_are_refused() {
        assert!(scroll_units(f64::NAN).is_err());
        assert!(scroll_units(f64::INFINITY).is_err());
        assert!(scroll_units(1.0e10).is_err());
    }
}
