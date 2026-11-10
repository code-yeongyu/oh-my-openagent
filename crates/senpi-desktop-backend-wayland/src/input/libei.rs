//! Pointer and keyboard actions on the discovered libei devices, each one
//! emulation burst that is flushed as a whole.

use reis::ei;
use senpi_desktop_core::backend::PointerEvent;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;

use crate::capture::layout::EisRegion;
use crate::compositor::hyprland::WindowRect;

use super::burst::Burst;
use super::keymap;
use super::preflight;
use super::{EiDevice, Libei};

pub(super) fn missing(kind: &str) -> DesktopError {
    DesktopError::permission_denied(format!(
        "RemoteDesktop portal did not provide a libei {kind}"
    ))
}

pub(super) fn start(devices: &[Option<&EiDevice>], sequence: &mut u32) {
    for device in devices.iter().flatten() {
        device
            .device
            .device()
            .start_emulating(device.serial, *sequence);
    }
    *sequence = sequence.wrapping_add(1);
}

/// Ends the burst on `devices` and sends it; the action's own error wins.
pub(super) fn finish(
    context: &ei::Context,
    devices: &[Option<&EiDevice>],
    result: CoreResult<()>,
) -> CoreResult<()> {
    for device in devices.iter().flatten() {
        device.device.device().stop_emulating(device.serial);
    }
    let flushed = context
        .flush()
        .map_err(|err| DesktopError::input_failed(format!("libei flush: {err}")));
    result.and(flushed)
}

fn region_contains(region: &EisRegion, (x, y): (f64, f64)) -> bool {
    #[expect(
        clippy::cast_precision_loss,
        reason = "region edges are u32 sums, far below f64's exact-integer range"
    )]
    let (right, bottom) = (region.right() as f64, region.bottom() as f64);
    x >= f64::from(region.x) && y >= f64::from(region.y) && x < right && y < bottom
}

/// Moves `event`, whose points are relative to a window whose frame origin was
/// `frame_origin`, onto the compositor's own `rect` for that window, in the
/// logical layout the libei `regions` share. Every point must land inside the
/// window, outside every `covering` window, and inside one libei region.
///
/// # Errors
/// `BackgroundUnavailable` when a point misses the window or lands on a window
/// that may sit above it; `InvalidCoordinateFrame` when it misses every region.
fn window_event(
    event: PointerEvent,
    frame_origin: (f64, f64),
    rect: &WindowRect,
    covering: &[WindowRect],
    regions: &[EisRegion],
) -> CoreResult<PointerEvent> {
    let place = |(x, y): (f64, f64)| -> CoreResult<(f64, f64)> {
        let point = (
            f64::from(rect.x) + x - frame_origin.0,
            f64::from(rect.y) + y - frame_origin.1,
        );
        if !rect.contains(point.0, point.1) {
            return Err(DesktopError::background_unavailable(format!(
                "point ({}, {}) is outside the target window's compositor geometry; no input was sent",
                point.0, point.1
            )));
        }
        if covering.iter().any(|other| other.contains(point.0, point.1)) {
            return Err(DesktopError::background_unavailable(format!(
                "point ({}, {}) of the target window may be covered by another window; no input was sent",
                point.0, point.1
            )));
        }
        if !regions.iter().any(|region| region_contains(region, point)) {
            return Err(DesktopError::invalid_coordinate_frame(format!(
                "point ({}, {}) falls outside every libei output region; no input was sent",
                point.0, point.1
            )));
        }
        Ok(point)
    };
    Ok(match event {
        PointerEvent::Click {
            x,
            y,
            button,
            count,
            modifiers,
        } => {
            let (x, y) = place((x, y))?;
            PointerEvent::Click {
                x,
                y,
                button,
                count,
                modifiers,
            }
        }
        PointerEvent::Move { x, y } => {
            let (x, y) = place((x, y))?;
            PointerEvent::Move { x, y }
        }
        PointerEvent::Drag {
            path,
            button,
            modifiers,
        } => PointerEvent::Drag {
            path: path.into_iter().map(place).collect::<CoreResult<_>>()?,
            button,
            modifiers,
        },
        PointerEvent::Scroll { x, y, dx, dy } => {
            let (x, y) = place((x, y))?;
            PointerEvent::Scroll { x, y, dx, dy }
        }
    })
}

impl Libei {
    /// Sends `event`, given relative to a window whose frame origin was
    /// `frame_origin`, at that window's compositor `rect` (see
    /// [`window_event`]); nothing is sent when any point is refused.
    ///
    /// # Errors
    /// The refusals of [`window_event`] and of [`Libei::pointer`].
    pub fn window_pointer(
        &mut self,
        event: PointerEvent,
        frame_origin: (f64, f64),
        rect: &WindowRect,
        covering: &[WindowRect],
    ) -> CoreResult<()> {
        let regions = self.regions()?;
        let event = window_event(event, frame_origin, rect, covering, &regions)?;
        self.pointer(event)
    }

    pub fn pointer(&mut self, event: PointerEvent) -> CoreResult<()> {
        self.refresh_devices()?;
        let admission = preflight::pointer(&self.devices, &event)?;
        let pointer = &self.devices[admission.pointer];
        let keyboard = admission.keyboard.map(|index| &self.devices[index]);
        let devices = [Some(pointer), keyboard];
        start(&devices, &mut self.sequence);
        let mut burst = Burst::new(&mut self.held_keys, &mut self.held_buttons);
        let result = burst.pointer(pointer, keyboard, event, admission.scroll);
        finish(&self.context, &devices, result)
    }

    pub fn key_chord(&mut self, keys: &[KeyName]) -> CoreResult<()> {
        self.refresh_devices()?;
        let keyboard = self
            .devices
            .iter()
            .find(|device| {
                device.resumed
                    && device
                        .device
                        .has_capability(reis::event::DeviceCapability::Keyboard)
            })
            .ok_or_else(|| missing("keyboard"))?;
        let mut codes = Vec::with_capacity(keys.len());
        for &key in keys {
            let stroke = keymap::key_stroke(keyboard.layout.as_ref(), key)?;
            codes.extend(stroke.modifiers);
            codes.push(stroke.keycode);
        }
        start(&[Some(keyboard)], &mut self.sequence);
        let mut burst = Burst::new(&mut self.held_keys, &mut self.held_buttons);
        let result = codes
            .iter()
            .try_for_each(|&code| burst.key(keyboard, code, true))
            .and_then(|()| {
                codes
                    .iter()
                    .rev()
                    .try_for_each(|&code| burst.key(keyboard, code, false))
            });
        finish(&self.context, &[Some(keyboard)], result)
    }

    pub fn type_text(&mut self, text: &str) -> CoreResult<()> {
        self.type_text_interruptible(text, &|| Ok(()), &mut || {})
    }

    pub fn type_text_interruptible(
        &mut self,
        text: &str,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        self.refresh_devices()?;
        let keyboard = self
            .devices
            .iter()
            .find(|device| {
                device.resumed
                    && device
                        .device
                        .has_capability(reis::event::DeviceCapability::Keyboard)
            })
            .ok_or_else(|| missing("keyboard"))?;
        let strokes = text
            .chars()
            .map(|character| keymap::char_stroke(keyboard.layout.as_ref(), character))
            .collect::<CoreResult<Vec<_>>>()?;
        start(&[Some(keyboard)], &mut self.sequence);
        let mut burst = Burst::new(&mut self.held_keys, &mut self.held_buttons);
        let result = strokes.iter().try_for_each(|stroke| {
            check_stop()?;
            let modifiers = &stroke.modifiers;
            modifiers
                .iter()
                .try_for_each(|&code| burst.key(keyboard, code, true))?;
            burst.key(keyboard, stroke.keycode, true)?;
            burst.key(keyboard, stroke.keycode, false)?;
            modifiers
                .iter()
                .rev()
                .try_for_each(|&code| burst.key(keyboard, code, false))?;
            delivered();
            Ok(())
        });
        finish(&self.context, &[Some(keyboard)], result)
    }

    /// Releases every key and button still down, newest first.
    pub fn release_all(&mut self) -> CoreResult<()> {
        let keys: Vec<u32> = self.held_keys.iter().rev().copied().collect();
        let buttons: Vec<u32> = self.held_buttons.iter().rev().copied().collect();
        self.refresh_devices()?;
        let keyboard = self.devices.iter().find(|device| {
            !keys.is_empty()
                && device.resumed
                && device
                    .device
                    .has_capability(reis::event::DeviceCapability::Keyboard)
        });
        let pointer = self.devices.iter().find(|device| {
            !buttons.is_empty()
                && device.resumed
                && device
                    .device
                    .has_capability(reis::event::DeviceCapability::Button)
        });
        if keyboard.is_none() && pointer.is_none() {
            return Ok(());
        }
        let devices = [keyboard, pointer];
        start(&devices, &mut self.sequence);
        let mut burst = Burst::new(&mut self.held_keys, &mut self.held_buttons);
        let result = keyboard
            .map_or(Ok(()), |device| {
                keys.iter()
                    .try_for_each(|&code| burst.key(device, code, false))
            })
            .and_then(|()| {
                pointer.map_or(Ok(()), |device| {
                    buttons
                        .iter()
                        .try_for_each(|&code| burst.button(device, code, false))
                })
            });
        finish(&self.context, &devices, result)
    }
}

#[cfg(test)]
mod window_event_tests {
    use senpi_desktop_core::backend::{Modifiers, MouseButton};
    use senpi_desktop_core::error::ErrorCode;

    use super::*;

    const DP1: EisRegion = EisRegion {
        x: 0,
        y: 0,
        width: 2560,
        height: 1440,
        scale: 1.0,
    };
    const HDMI: EisRegion = EisRegion {
        x: 2560,
        y: 0,
        width: 1920,
        height: 1080,
        scale: 1.0,
    };
    const EDITOR: WindowRect = WindowRect {
        x: 1290,
        y: 48,
        width: 1260,
        height: 1012,
    };

    fn click(x: f64, y: f64) -> PointerEvent {
        PointerEvent::Click {
            x,
            y,
            button: MouseButton::Left,
            count: 1,
            modifiers: Modifiers::default(),
        }
    }

    #[test]
    fn a_window_point_lands_on_the_compositor_rect_inside_its_output_region() {
        // Given: AT-SPI reports the window at (0, 0); Hyprland places it at (1290, 48)
        let event = window_event(click(100.0, 20.0), (0.0, 0.0), &EDITOR, &[], &[DP1, HDMI]);

        // Then: the click lands at the compositor position, inside DP-1
        assert!(
            matches!(event, Ok(PointerEvent::Click { x, y, .. }) if (x, y) == (1390.0, 68.0)),
            "{event:?}"
        );
    }

    #[test]
    fn every_drag_point_is_moved_and_checked() {
        let drag = PointerEvent::Drag {
            path: vec![(10.0, 10.0), (1200.0, 900.0)],
            button: MouseButton::Left,
            modifiers: Modifiers::default(),
        };
        let moved = window_event(drag, (0.0, 0.0), &EDITOR, &[], &[DP1]).expect("inside");
        assert!(matches!(moved, PointerEvent::Drag { ref path, .. } if path == &[(1300.0, 58.0), (2490.0, 948.0)]));

        let escaping = PointerEvent::Drag {
            path: vec![(10.0, 10.0), (1300.0, 10.0)],
            button: MouseButton::Left,
            modifiers: Modifiers::default(),
        };
        let error = window_event(escaping, (0.0, 0.0), &EDITOR, &[], &[DP1]).expect_err("leaves the window");
        assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    }

    #[test]
    fn a_covered_point_is_refused() {
        let dialog = WindowRect {
            x: 1500,
            y: 300,
            width: 600,
            height: 400,
        };
        let error = window_event(click(300.0, 300.0), (0.0, 0.0), &EDITOR, &[dialog], &[DP1]).expect_err("covered");
        assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
        assert!(error.message.contains("covered"), "{}", error.message);
    }

    #[test]
    fn a_point_outside_every_libei_region_is_refused() {
        let error = window_event(click(100.0, 20.0), (0.0, 0.0), &EDITOR, &[], &[HDMI]).expect_err("no region");
        assert_eq!(error.code, ErrorCode::InvalidCoordinateFrame);
    }
}
