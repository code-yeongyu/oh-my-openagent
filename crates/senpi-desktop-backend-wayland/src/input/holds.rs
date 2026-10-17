//! A bounded libei emulation burst flushes presses before its wait and
//! releases on the same devices before ending emulation.

use reis::{ei, event::DeviceCapability};
use senpi_desktop_core::backend::{Modifiers, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::holds::{merge_release, with_held, HoldControl, MouseHold};
use senpi_desktop_core::keys::KeyName;

use super::burst::{button_code, Burst};
use super::libei::{finish, missing, start};
use super::{keymap, preflight, EiDevice, Libei};

#[derive(Clone, Copy)]
enum HeldEvent<'a> {
    Key(&'a EiDevice, u32),
    Button(&'a EiDevice, u32),
}

impl Libei {
    pub fn hold_keys(&mut self, keys: &[KeyName], control: &HoldControl<'_>) -> CoreResult<()> {
        self.refresh_devices()?;
        let keyboard = self.devices.iter().find(|device| {
            device.resumed && device.device.has_capability(DeviceCapability::Keyboard)
        }).ok_or_else(|| missing("keyboard"))?;
        let events = key_events(keyboard, keys)?;
        let devices = [Some(keyboard)];
        start(&devices, &mut self.sequence);
        let mut burst = Burst::new(&mut self.held_keys, &mut self.held_buttons);
        let mut result = hold_events(&mut burst, &self.context, &events, control);
        merge_release(&mut result, finish(&self.context, &devices, Ok(())));
        result
    }

    pub fn hold_mouse(&mut self, hold: &MouseHold<'_>, control: &HoldControl<'_>) -> CoreResult<()> {
        self.refresh_devices()?;
        let admission = preflight::pointer(&self.devices, &PointerEvent::Click {
            x: hold.x, y: hold.y, button: hold.button, count: 1, modifiers: Modifiers::default(),
        })?;
        let pointer = &self.devices[admission.pointer];
        let keyboard = if hold.keys.is_empty() {
            None
        } else {
            Some(self.devices.iter().find(|device| {
                device.resumed && device.device.seat() == pointer.device.seat()
                    && device.device.has_capability(DeviceCapability::Keyboard)
            }).ok_or_else(|| missing("keyboard on the pointer's seat"))?)
        };
        let mut events = keyboard.map_or(Ok(Vec::new()), |device| key_events(device, hold.keys))?;
        events.push(HeldEvent::Button(pointer, button_code(hold.button)));
        (control.check)()?;
        let devices = [Some(pointer), keyboard];
        start(&devices, &mut self.sequence);
        let mut burst = Burst::new(&mut self.held_keys, &mut self.held_buttons);
        let mut result = burst.motion(pointer, (hold.x, hold.y))
            .and_then(|()| flush(&self.context))
            .and_then(|()| hold_events(&mut burst, &self.context, &events, control));
        merge_release(&mut result, finish(&self.context, &devices, Ok(())));
        result
    }
}

fn key_events<'a>(device: &'a EiDevice, keys: &[KeyName]) -> CoreResult<Vec<HeldEvent<'a>>> {
    let mut events = Vec::new();
    for &key in keys {
        let stroke = keymap::key_stroke(device.layout.as_ref(), key)?;
        events.extend(stroke.modifiers.into_iter().map(|code| HeldEvent::Key(device, code)));
        events.push(HeldEvent::Key(device, stroke.keycode));
    }
    Ok(events)
}

fn hold_events(
    burst: &mut Burst<'_>, context: &ei::Context, events: &[HeldEvent<'_>], control: &HoldControl<'_>,
) -> CoreResult<()> {
    with_held(burst, events, control.check, |burst, event, down| {
        match event {
            HeldEvent::Key(device, code) => burst.key(device, code, down)?,
            HeldEvent::Button(device, code) => burst.button(device, code, down)?,
        }
        flush(context)
    }, |_| (control.wait)())
}

fn flush(context: &ei::Context) -> CoreResult<()> {
    context.flush().map_err(|error| DesktopError::input_failed(format!("libei flush: {error}")))
}
