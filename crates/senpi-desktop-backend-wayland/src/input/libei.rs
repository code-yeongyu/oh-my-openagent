//! Pointer and keyboard actions on the discovered libei devices, each one
//! emulation burst that is flushed as a whole.

use reis::ei;
use senpi_desktop_core::backend::{Modifiers, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;

use super::burst::Burst;
use super::keymap;
use super::{EiDevice, Libei};

fn missing(kind: &str) -> DesktopError {
    DesktopError::permission_denied(format!("RemoteDesktop portal did not provide a libei {kind}"))
}

fn start(devices: &[Option<&EiDevice>], sequence: &mut u32) {
    for device in devices.iter().flatten() {
        device.device.device().start_emulating(device.serial, *sequence);
    }
    *sequence = sequence.wrapping_add(1);
}

/// Ends the burst on `devices` and sends it; the action's own error wins.
fn finish(context: &ei::Context, devices: &[Option<&EiDevice>], result: CoreResult<()>) -> CoreResult<()> {
    for device in devices.iter().flatten() {
        device.device.device().stop_emulating(device.serial);
    }
    let flushed = context
        .flush()
        .map_err(|err| DesktopError::input_failed(format!("libei flush: {err}")));
    result.and(flushed)
}

impl Libei {
    pub fn pointer(&mut self, event: PointerEvent) -> CoreResult<()> {
        let pointer = self.pointer.as_ref().ok_or_else(|| missing("pointer"))?;
        let chord = match &event {
            PointerEvent::Click { modifiers, .. } | PointerEvent::Drag { modifiers, .. } => *modifiers,
            PointerEvent::Move { .. } | PointerEvent::Scroll { .. } => Modifiers::default(),
        };
        let keyboard = self.keyboard.as_ref().filter(|_| chord != Modifiers::default());
        let devices = [Some(pointer), keyboard];
        start(&devices, &mut self.sequence);
        let mut burst = Burst::new(&mut self.held_keys, &mut self.held_buttons);
        let result = burst.pointer(pointer, keyboard, event);
        finish(&self.context, &devices, result)
    }

    pub fn key_chord(&mut self, keys: &[KeyName]) -> CoreResult<()> {
        self.refresh_keyboard_state()?;
        let keyboard = self.keyboard.as_ref().ok_or_else(|| missing("keyboard"))?;
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
        self.refresh_keyboard_state()?;
        let keyboard = self.keyboard.as_ref().ok_or_else(|| missing("keyboard"))?;
        let strokes = text
            .chars()
            .map(|character| keymap::char_stroke(keyboard.layout.as_ref(), character))
            .collect::<CoreResult<Vec<_>>>()?;
        start(&[Some(keyboard)], &mut self.sequence);
        let mut burst = Burst::new(&mut self.held_keys, &mut self.held_buttons);
        let result = strokes.iter().try_for_each(|stroke| {
            let modifiers = &stroke.modifiers;
            modifiers
                .iter()
                .try_for_each(|&code| burst.key(keyboard, code, true))?;
            burst.key(keyboard, stroke.keycode, true)?;
            burst.key(keyboard, stroke.keycode, false)?;
            modifiers
                .iter()
                .rev()
                .try_for_each(|&code| burst.key(keyboard, code, false))
        });
        finish(&self.context, &[Some(keyboard)], result)
    }

    /// Releases every key and button still down, newest first.
    pub fn release_all(&mut self) -> CoreResult<()> {
        let keys: Vec<u32> = self.held_keys.iter().rev().copied().collect();
        let buttons: Vec<u32> = self.held_buttons.iter().rev().copied().collect();
        let keyboard = self.keyboard.as_ref().filter(|_| !keys.is_empty());
        let pointer = self.pointer.as_ref().filter(|_| !buttons.is_empty());
        if keyboard.is_none() && pointer.is_none() {
            return Ok(());
        }
        let devices = [keyboard, pointer];
        start(&devices, &mut self.sequence);
        let mut burst = Burst::new(&mut self.held_keys, &mut self.held_buttons);
        let result = keyboard
            .map_or(Ok(()), |device| {
                keys.iter().try_for_each(|&code| burst.key(device, code, false))
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
