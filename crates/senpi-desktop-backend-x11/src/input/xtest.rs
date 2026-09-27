//! XTEST pointer delivery: real core-device input at root coordinates, for
//! the desktop target and for foreground window delivery.

use std::thread;
use std::time::Duration;

use senpi_desktop_core::backend::{Modifiers, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::held::{HeldButton, Route};
use super::keys::{modifier_keys, Stroke};
use super::server::{FakeInput, InputServer};
use super::{root_spot, X11Input};

/// Between a button's press and release, and between repeated clicks.
pub const CLICK_DELAY: Duration = Duration::from_millis(12);
/// Between the points of a drag path.
pub const DRAG_STEP_DELAY: Duration = Duration::from_millis(8);
/// Wheel clicks per scroll axis are capped; a larger delta is a caller bug.
const MAX_SCROLL_CLICKS: f64 = 1_000.0;

impl<S: InputServer> X11Input<S> {
    pub(super) fn pointer_xtest(&mut self, event: &PointerEvent) -> CoreResult<()> {
        match event {
            PointerEvent::Click {
                x,
                y,
                button,
                count,
                modifiers,
            } => {
                let (x, y) = point(*x, *y)?;
                self.motion_xtest(x, y)?;
                let down = xtest_button(button_detail(*button), x, y);
                self.with_xtest_modifiers(*modifiers, |this| {
                    for _ in 0..(*count).max(1) {
                        this.button(down, true, 0)?;
                        thread::sleep(CLICK_DELAY);
                        this.button(down, false, 0)?;
                    }
                    Ok(())
                })?;
            }
            PointerEvent::Move { x, y } => {
                let (x, y) = point(*x, *y)?;
                self.motion_xtest(x, y)?;
            }
            PointerEvent::Drag {
                path,
                button,
                modifiers,
            } => {
                let points = path
                    .iter()
                    .map(|&(x, y)| point(x, y))
                    .collect::<CoreResult<Vec<_>>>()?;
                let Some(&(x, y)) = points.first() else {
                    return Err(DesktopError::input_failed("drag path is empty"));
                };
                self.motion_xtest(x, y)?;
                let down = xtest_button(button_detail(*button), x, y);
                self.with_xtest_modifiers(*modifiers, |this| {
                    this.button(down, true, 0)?;
                    let moved = points.iter().skip(1).try_for_each(|&(x, y)| {
                        thread::sleep(DRAG_STEP_DELAY);
                        this.motion_xtest(x, y)
                    });
                    let released = this.button(down, false, 0);
                    moved.and(released)
                })?;
            }
            PointerEvent::Scroll { x, y, dx, dy } => {
                let (x, y) = point(*x, *y)?;
                self.motion_xtest(x, y)?;
                for (detail, clicks) in scroll_buttons(*dx, *dy) {
                    let wheel = xtest_button(detail, x, y);
                    for _ in 0..clicks {
                        self.button(wheel, true, 0)?;
                        self.button(wheel, false, 0)?;
                    }
                }
            }
        }
        self.server.flush()
    }

    fn motion_xtest(&self, x: i16, y: i16) -> CoreResult<()> {
        self.server.fake(FakeInput::Motion { x, y })
    }

    /// Holds the gesture's modifier keys (XTEST) around `body`; they are
    /// released even when `body` fails.
    fn with_xtest_modifiers(
        &mut self,
        modifiers: Modifiers,
        body: impl FnOnce(&mut Self) -> CoreResult<()>,
    ) -> CoreResult<()> {
        let strokes = modifier_keys(modifiers)
            .into_iter()
            .map(|key| self.server.keymap().stroke(key))
            .collect::<CoreResult<Vec<Stroke>>>()?;
        let mut pressed = Vec::with_capacity(strokes.len());
        let mut result = Ok(());
        for stroke in strokes {
            result = self.key(Route::Xtest, stroke, true, 0);
            if result.is_err() {
                break;
            }
            pressed.push(stroke);
        }
        if result.is_ok() {
            result = body(self);
        }
        for &stroke in pressed.iter().rev() {
            let released = self.key(Route::Xtest, stroke, false, 0);
            result = result.and(released);
        }
        result
    }
}

const fn xtest_button(detail: u8, x: i16, y: i16) -> HeldButton {
    HeldButton {
        route: Route::Xtest,
        detail,
        at: root_spot(x, y),
    }
}

/// Validates a root-coordinate point for the signed 16-bit X protocol.
///
/// # Errors
/// `InvalidCoordinateFrame` for a non-finite or out-of-range value.
pub fn point(x: f64, y: f64) -> CoreResult<(i16, i16)> {
    Ok((coordinate(x, "x")?, coordinate(y, "y")?))
}

fn coordinate(value: f64, axis: &str) -> CoreResult<i16> {
    let rounded = value.round();
    if !rounded.is_finite() || rounded < f64::from(i16::MIN) || rounded > f64::from(i16::MAX) {
        return Err(DesktopError::invalid_coordinate_frame(format!(
            "X11 {axis} coordinate {value} exceeds the signed 16-bit protocol range"
        )));
    }
    // In range and integral: the conversion is exact.
    Ok(rounded as i16)
}

pub const fn button_detail(button: senpi_desktop_core::backend::MouseButton) -> u8 {
    use senpi_desktop_core::backend::MouseButton;
    match button {
        MouseButton::Left => 1,
        MouseButton::Middle => 2,
        MouseButton::Right => 3,
    }
}

/// Wheel buttons and click counts: 4/5 up/down, 6/7 left/right.
pub fn scroll_buttons(dx: f64, dy: f64) -> Vec<(u8, u32)> {
    [(dy, 4, 5), (dx, 6, 7)]
        .into_iter()
        .filter_map(|(delta, negative, positive)| {
            let magnitude = delta.abs().round();
            // Not NaN, non-negative, integral and capped: the conversion is exact.
            let clicks = if magnitude.is_nan() {
                0
            } else {
                magnitude.min(MAX_SCROLL_CLICKS) as u32
            };
            (clicks > 0).then_some((if delta < 0.0 { negative } else { positive }, clicks))
        })
        .collect()
}
