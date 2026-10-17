//! XTEST and background XSendEvent bounded input ownership.

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::holds::{with_held, HoldControl, MouseHold};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::Target;
use x11rb::protocol::xproto::Window;

use super::held::{HeldButton, Route};
use super::keys::Stroke;
use super::server::Spot;
use super::{parse_window, root_spot, xtest, InputServer, X11Input};

impl<S: InputServer> X11Input<S> {
    pub fn hold_keys(
        &mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode, control: &HoldControl<'_>,
    ) -> CoreResult<()> {
        let strokes = self.hold_strokes(keys)?;
        self.deliver_keys(target, mode, "key", |this, route| {
            this.keys_held(route, &strokes, control, |_, _| (control.wait)())
        })
    }

    pub fn hold_mouse(
        &mut self, target: &Target, hold: &MouseHold<'_>, mode: DeliveryMode, control: &HoldControl<'_>,
    ) -> CoreResult<()> {
        self.last_pointer_motion = None;
        let strokes = self.hold_strokes(hold.keys)?;
        let (x, y) = xtest::point(hold.x, hold.y)?;
        match (target, mode) {
            (Target::Desktop | Target::Display(_), _) => self.system_hold(hold, &strokes, None, control),
            (Target::Window(id), DeliveryMode::Foreground) => {
                let window = parse_window(id)?;
                self.with_foreground(window, |this| this.system_hold(hold, &strokes, Some(window), control))
            }
            (Target::Window(id), DeliveryMode::Background) => {
                let top = self.background_window(id, "click")?;
                if !hold.keys.is_empty() {
                    self.background_window(id, "key")?;
                }
                let window = self.server.target_at(top, x, y)?;
                let route = Route::Window(window);
                let at = Spot { root: (x, y), local: self.server.translate(window, x, y)? };
                let button = HeldButton { route, detail: xtest::button_detail(hold.button), at };
                self.keys_held(Route::Window(top), &strokes, control, |this, state| {
                    this.button_held(button, state, control)
                })
            }
        }
    }

    fn hold_strokes(&self, keys: &[KeyName]) -> CoreResult<Vec<Stroke>> {
        let keymap = self.server.keymap()?;
        let mut strokes = Vec::new();
        for &key in keys {
            strokes.extend(keymap.strokes(key)?);
        }
        Ok(strokes)
    }

    fn keys_held(
        &mut self, route: Route, strokes: &[Stroke], control: &HoldControl<'_>,
        operation: impl FnOnce(&mut Self, u16) -> CoreResult<()>,
    ) -> CoreResult<()> {
        with_held(
            &mut (self, 0u16), strokes, control.check,
            |(this, state), stroke, down| {
                let result = this.key(route, stroke, down, *state);
                if down {
                    *state |= stroke.mask;
                } else {
                    *state &= !stroke.mask;
                }
                result?;
                this.server.flush()
            },
            |(this, state)| operation(this, *state),
        )
    }

    fn system_hold(
        &mut self, hold: &MouseHold<'_>, strokes: &[Stroke], over: Option<Window>,
        control: &HoldControl<'_>,
    ) -> CoreResult<()> {
        (control.check)()?;
        let (x, y) = xtest::point(hold.x, hold.y)?;
        self.approach(x, y, over)?;
        let button = HeldButton {
            route: Route::Xtest, detail: xtest::button_detail(hold.button), at: root_spot(x, y),
        };
        self.keys_held(Route::Xtest, strokes, control, |this, state| {
            this.button_held(button, state, control)
        })
    }

    fn button_held(
        &mut self, button: HeldButton, state: u16, control: &HoldControl<'_>,
    ) -> CoreResult<()> {
        with_held(self, &[button], control.check, |this, button, down| {
            let button_state = if down { state } else {
                state | super::send_event::button_mask(button.detail)
            };
            this.button(button, down, button_state)?;
            this.server.flush()
        }, |_| (control.wait)())
    }
}
