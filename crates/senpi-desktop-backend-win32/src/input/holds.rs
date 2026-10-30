//! Native bounded holds; cleanup retains the original HWND/system route.

use senpi_desktop_core::backend::{DeliveryMode, Modifiers};
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::holds::{with_held, HoldControl, MouseHold};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::Target;

use super::dispatch::{char_stroke, to_physical, Via, Win32Input};
use super::held::{HeldButton, HeldKey, Route};
use super::keys::{chord_virtual_keys, named_virtual_key, Stroke};
use super::{background, background_pointer, compositor, messages, native::Window, system};
use crate::delivery::EventKind;

impl Win32Input {
    pub(crate) fn hold_keys(
        &mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode, control: &HoldControl<'_>,
    ) -> CoreResult<()> {
        let codes = hold_codes(keys)?;
        match (target, mode) {
            (Target::Desktop | Target::Display(_), _) => {
                self.keys_held(Via::Enigo, &codes, control, |_| (control.wait)())
            }
            (Target::Window(id), DeliveryMode::Foreground) => self.with_foreground(id, |this, window| {
                this.keys_held(Via::SendInput(Some(window)), &codes, control, |_| (control.wait)())
            }),
            (Target::Window(id), DeliveryMode::Background) => {
                let window = background::key_target(id, self.integrity, keys)?;
                self.keys_held(Via::Post(window), &codes, control, |_| (control.wait)())
            }
        }
    }

    pub(crate) fn hold_mouse(
        &mut self, target: &Target, hold: &MouseHold<'_>, mode: DeliveryMode, control: &HoldControl<'_>,
    ) -> CoreResult<()> {
        let codes = hold_codes(hold.keys)?;
        let physical = to_physical(hold.x, hold.y)?;
        match (target, mode) {
            (Target::Desktop | Target::Display(_), _) => {
                self.system_hold(hold, physical, None, &codes, control)
            }
            (Target::Window(id), DeliveryMode::Foreground) => self.with_foreground(id, |this, window| {
                compositor::await_next_present();
                this.system_hold(hold, physical, Some(window), &codes, control)
            }),
            (Target::Window(id), DeliveryMode::Background) => {
                let root = Window::target(id, self.integrity)?;
                background::refusal(id, root, EventKind::MouseClick).map_or(Ok(()), Err)?;
                let (window, at) = background_pointer::child_at(root, hold.x, hold.y)?;
                background::refusal(id, window, EventKind::MouseClick).map_or(Ok(()), Err)?;
                let keyboard = if hold.keys.is_empty() { window }
                    else { background::key_target(id, self.integrity, hold.keys)? };
                let held = HeldButton { route: Route::Window(window.address()), button: hold.button, at };
                self.keys_held(Via::Post(keyboard), &codes, control, |this| {
                    this.button_held(held, None, key_flags(hold.keys), control)
                })
            }
        }
    }

    fn keys_held(
        &mut self, via: Via, codes: &[u16], control: &HoldControl<'_>,
        operation: impl FnOnce(&mut Self) -> CoreResult<()>,
    ) -> CoreResult<()> {
        with_held(self, codes, control.check, |this, vk, down| {
            if down {
                this.held.key_down(HeldKey { route: via.route(), vk });
            }
            this.transition(via, vk, down)
        }, operation)
    }

    fn system_hold(
        &mut self, hold: &MouseHold<'_>, at: (i32, i32), target: Option<Window>,
        codes: &[u16], control: &HoldControl<'_>,
    ) -> CoreResult<()> {
        (control.check)()?;
        system::place_cursor(at, target)?;
        let held = HeldButton { route: Route::System, button: hold.button, at: 0 };
        self.keys_held(Via::SendInput(target), codes, control, |this| {
            this.button_held(held, target, 0, control)
        })
    }

    fn button_held(
        &mut self, held: HeldButton, target: Option<Window>, flags: usize,
        control: &HoldControl<'_>,
    ) -> CoreResult<()> {
        with_held(self, &[held], control.check, |this, held, down| {
            if down {
                this.held.button_down(held);
            }
            match held.route {
                Route::System => system::button(held.button, down, target)?,
                Route::Window(address) => {
                    let messages = messages::button_messages(held.button);
                    background::post(Window(address),
                        if down { messages.down } else { messages.up },
                        if down { flags | messages.flag } else { flags }, held.at)?;
                }
            }
            if !down {
                this.held.button_up(held.route, held.button);
            }
            Ok(())
        }, |_| (control.wait)())
    }
}

fn hold_codes(keys: &[KeyName]) -> CoreResult<Vec<u16>> {
    let strokes = keys.iter().map(|&key| {
        named_virtual_key(key).map_or_else(|| char_stroke(key), |vk| Ok(Stroke::plain(vk)))
    }).collect::<CoreResult<Vec<_>>>()?;
    Ok(chord_virtual_keys(&strokes))
}

fn key_flags(keys: &[KeyName]) -> usize {
    messages::modifier_flags(Modifiers {
        ctrl: keys.contains(&KeyName::Ctrl),
        alt: keys.contains(&KeyName::Alt),
        shift: keys.contains(&KeyName::Shift),
        meta: keys.contains(&KeyName::Meta),
    })
}
