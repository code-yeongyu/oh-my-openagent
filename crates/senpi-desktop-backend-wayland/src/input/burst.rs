//! One emulation burst on the discovered libei devices: every event gets
//! its own frame with a strictly increasing timestamp, and every press is
//! recorded until its release so `release_all` can lift it.

use std::time::{SystemTime, UNIX_EPOCH};

use reis::ei;
use senpi_desktop_core::backend::{Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::keymap::{ALT, CTRL, META, SHIFT};
use super::EiDevice;

/// One emulation burst; see the module docs.
pub struct Burst<'a> {
    time: u64,
    held_keys: &'a mut Vec<u32>,
    held_buttons: &'a mut Vec<u32>,
}

fn track(held: &mut Vec<u32>, code: u32, pressed: bool) {
    if !pressed {
        held.retain(|held| *held != code);
    } else if !held.contains(&code) {
        held.push(code);
    }
}

impl<'a> Burst<'a> {
    pub fn new(held_keys: &'a mut Vec<u32>, held_buttons: &'a mut Vec<u32>) -> Self {
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| {
                u64::try_from(elapsed.as_micros()).unwrap_or(u64::MAX)
            });
        Self {
            time,
            held_keys,
            held_buttons,
        }
    }

    fn frame(&mut self, device: &EiDevice) {
        device.device.device().frame(device.serial, self.time);
        self.time = self.time.saturating_add(1);
    }

    pub fn key(&mut self, device: &EiDevice, keycode: u32, pressed: bool) -> CoreResult<()> {
        let keyboard = device
            .device
            .interface::<ei::Keyboard>()
            .ok_or_else(|| DesktopError::input_failed("libei device has no keyboard interface"))?;
        keyboard.key(
            keycode,
            if pressed {
                ei::keyboard::KeyState::Press
            } else {
                ei::keyboard::KeyState::Released
            },
        );
        track(self.held_keys, keycode, pressed);
        self.frame(device);
        Ok(())
    }

    pub fn button(&mut self, device: &EiDevice, code: u32, pressed: bool) -> CoreResult<()> {
        let buttons = device
            .device
            .interface::<ei::Button>()
            .ok_or_else(|| DesktopError::input_failed("libei device has no button interface"))?;
        buttons.button(
            code,
            if pressed {
                ei::button::ButtonState::Press
            } else {
                ei::button::ButtonState::Released
            },
        );
        track(self.held_buttons, code, pressed);
        self.frame(device);
        Ok(())
    }

    fn motion(&mut self, device: &EiDevice, (x, y): (f64, f64)) -> CoreResult<()> {
        let pointer = device
            .device
            .interface::<ei::PointerAbsolute>()
            .ok_or_else(|| {
                DesktopError::input_failed("libei device has no absolute pointer interface")
            })?;
        pointer.motion_absolute(x as f32, y as f32);
        self.frame(device);
        Ok(())
    }

    fn scroll(&mut self, device: &EiDevice, (dx, dy): (i32, i32)) -> CoreResult<()> {
        let scroll = device
            .device
            .interface::<ei::Scroll>()
            .ok_or_else(|| DesktopError::input_failed("libei device has no scroll interface"))?;
        scroll.scroll_discrete(dx, dy);
        self.frame(device);
        Ok(())
    }

    fn modifiers(
        &mut self,
        keyboard: &EiDevice,
        modifiers: Modifiers,
        pressed: bool,
    ) -> CoreResult<()> {
        let keys = [
            (modifiers.ctrl, CTRL),
            (modifiers.alt, ALT),
            (modifiers.shift, SHIFT),
            (modifiers.meta, META),
        ];
        keys.into_iter()
            .filter(|(enabled, _)| *enabled)
            .try_for_each(|(_, key)| self.key(keyboard, key, pressed))
    }

    pub fn pointer(
        &mut self,
        pointer: &EiDevice,
        keyboard: Option<&EiDevice>,
        event: PointerEvent,
        scroll: Option<(i32, i32)>,
    ) -> CoreResult<()> {
        match event {
            PointerEvent::Move { x, y } => self.motion(pointer, (x, y)),
            PointerEvent::Scroll { x, y, dx, dy } => {
                self.motion(pointer, (x, y))?;
                let _ = (dx, dy);
                self.scroll(
                    pointer,
                    scroll.ok_or_else(|| {
                        DesktopError::input_failed("libei scroll units were not preflighted")
                    })?,
                )
            }
            PointerEvent::Click {
                x,
                y,
                button,
                count,
                modifiers,
            } => {
                self.motion(pointer, (x, y))?;
                if modifiers != Modifiers::default() {
                    self.modifiers(
                        keyboard.ok_or_else(|| {
                            DesktopError::permission_denied(
                                "libei modifier keyboard was not preflighted",
                            )
                        })?,
                        modifiers,
                        true,
                    )?;
                }
                for _ in 0..count.max(1) {
                    self.button(pointer, button_code(button), true)?;
                    self.button(pointer, button_code(button), false)?;
                }
                if modifiers != Modifiers::default() {
                    self.modifiers(
                        keyboard.ok_or_else(|| {
                            DesktopError::permission_denied(
                                "libei modifier keyboard was not preflighted",
                            )
                        })?,
                        modifiers,
                        false,
                    )?;
                }
                Ok(())
            }
            PointerEvent::Drag {
                path,
                button,
                modifiers,
            } => {
                let (&first, rest) = path
                    .split_first()
                    .ok_or_else(|| DesktopError::input_failed("libei drag path is empty"))?;
                self.motion(pointer, first)?;
                if modifiers != Modifiers::default() {
                    self.modifiers(
                        keyboard.ok_or_else(|| {
                            DesktopError::permission_denied(
                                "libei modifier keyboard was not preflighted",
                            )
                        })?,
                        modifiers,
                        true,
                    )?;
                }
                self.button(pointer, button_code(button), true)?;
                rest.iter()
                    .try_for_each(|&point| self.motion(pointer, point))?;
                self.button(pointer, button_code(button), false)?;
                if modifiers != Modifiers::default() {
                    self.modifiers(
                        keyboard.ok_or_else(|| {
                            DesktopError::permission_denied(
                                "libei modifier keyboard was not preflighted",
                            )
                        })?,
                        modifiers,
                        false,
                    )?;
                }
                Ok(())
            }
        }
    }
}

const fn button_code(button: MouseButton) -> u32 {
    match button {
        MouseButton::Left => 0x110,
        MouseButton::Right => 0x111,
        MouseButton::Middle => 0x112,
    }
}
