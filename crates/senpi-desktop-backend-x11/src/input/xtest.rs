//! XTEST pointer delivery: real core-device input at root coordinates, for
//! the desktop target and for foreground window delivery.

use std::thread;
use std::time::Duration;

use senpi_desktop_core::backend::{Modifiers, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use x11rb::protocol::xproto::Window;

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
/// Pixels per wheel click: scroll deltas are pixels on every OS, and one
/// click stands for about 40 of them.
const PIXELS_PER_CLICK: f64 = 40.0;

impl<S: InputServer> X11Input<S> {
    /// Delivers `event` through XTEST; with `over`, the first motion must
    /// leave the pointer over that window before any button is sent, and each
    /// click is delivered before the next press is sent.
    pub(super) fn pointer_xtest(&mut self, event: &PointerEvent, over: Option<Window>) -> CoreResult<()> {
        match event {
            PointerEvent::Click {
                x,
                y,
                button,
                count,
                modifiers,
            } => {
                let (x, y) = point(*x, *y)?;
                self.approach(x, y, over)?;
                let down = xtest_button(button_detail(*button), x, y);
                self.with_xtest_modifiers(*modifiers, |this| {
                    for _ in 0..(*count).max(1) {
                        this.button(down, true, 0)?;
                        thread::sleep(CLICK_DELAY);
                        this.button(down, false, 0)?;
                        this.delivered(over)?;
                    }
                    Ok(())
                })?;
            }
            PointerEvent::Move { x, y } => {
                let (x, y) = point(*x, *y)?;
                self.approach(x, y, over)?;
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
                self.approach(x, y, over)?;
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
                self.approach(x, y, over)?;
                for (detail, clicks) in scroll_buttons(*dx, *dy) {
                    let wheel = xtest_button(detail, x, y);
                    for _ in 0..clicks {
                        self.button(wheel, true, 0)?;
                        self.button(wheel, false, 0)?;
                        self.delivered(over)?;
                    }
                }
            }
        }
        self.server.flush()
    }

    fn approach(&mut self, x: i16, y: i16, over: Option<Window>) -> CoreResult<()> {
        self.motion_xtest(x, y)?;
        over.map_or(Ok(()), |window| self.await_pointer_within(window, (x, y)))
    }

    fn delivered(&self, over: Option<Window>) -> CoreResult<()> {
        self.server.flush()?;
        over.map_or(Ok(()), |window| self.await_pointer_released(window))
    }

    fn motion_xtest(&mut self, x: i16, y: i16) -> CoreResult<()> {
        self.server.fake(FakeInput::Motion { x, y })?;
        self.last_pointer_motion = Some(senpi_desktop_core::types::DesktopPoint {
            x: f64::from(x),
            y: f64::from(y),
        });
        Ok(())
    }

    /// Holds the gesture's modifier keys (XTEST) around `body`; they are
    /// released even when `body` fails.
    fn with_xtest_modifiers(
        &mut self,
        modifiers: Modifiers,
        body: impl FnOnce(&mut Self) -> CoreResult<()>,
    ) -> CoreResult<()> {
        let keymap = self.server.keymap()?;
        let strokes = modifier_keys(modifiers)
            .into_iter()
            .map(|key| keymap.stroke(key))
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

/// Wheel buttons and click counts for pixel deltas: 4/5 up/down, 6/7
/// left/right, one click per `PIXELS_PER_CLICK` pixels rounded half up, at
/// least one click for any motion, capped at `MAX_SCROLL_CLICKS`.
pub fn scroll_buttons(dx: f64, dy: f64) -> Vec<(u8, u32)> {
    [(dy, 4, 5), (dx, 6, 7)]
        .into_iter()
        .filter_map(|(delta, negative, positive)| {
            let pixels = delta.abs();
            // Positive (so not NaN), integral and within 1..=cap: the conversion is exact.
            let clicks = if pixels > 0.0 {
                (pixels / PIXELS_PER_CLICK + 0.5)
                    .floor()
                    .clamp(1.0, MAX_SCROLL_CLICKS) as u32
            } else {
                0
            };
            (clicks > 0).then_some((if delta < 0.0 { negative } else { positive }, clicks))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::scroll_buttons;

    #[test]
    fn scroll_pixels_become_clicks_of_forty_pixels() {
        let clicks: Vec<Vec<(u8, u32)>> = [0.0, 1.0, -1.0, 19.0, 59.0, 60.0, 120.0, -120.0]
            .into_iter()
            .map(|dy| scroll_buttons(0.0, dy))
            .collect();

        assert_eq!(
            clicks,
            [
                vec![],
                vec![(5, 1)],
                vec![(4, 1)],
                vec![(5, 1)],
                vec![(5, 1)],
                vec![(5, 2)],
                vec![(5, 3)],
                vec![(4, 3)],
            ]
        );
    }

    #[test]
    fn horizontal_pixels_use_buttons_six_and_seven() {
        assert_eq!(scroll_buttons(80.0, 0.0), [(7, 2)]);
        assert_eq!(scroll_buttons(-80.0, 40.0), [(5, 1), (6, 2)]);
    }

    #[test]
    fn the_click_cap_applies_after_conversion() {
        // 39_980 px is 999.5 clicks, rounded up to the cap; beyond it stays capped.
        assert_eq!(scroll_buttons(0.0, 39_980.0), [(5, 1_000)]);
        assert_eq!(scroll_buttons(0.0, 1_000.0), [(5, 25)]);
        assert_eq!(scroll_buttons(0.0, -1.0e9), [(4, 1_000)]);
        assert_eq!(scroll_buttons(f64::NAN, f64::INFINITY), [(5, 1_000)]);
    }
}
