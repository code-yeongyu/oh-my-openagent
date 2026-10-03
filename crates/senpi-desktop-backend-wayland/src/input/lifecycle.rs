use std::os::fd::AsFd;
use std::time::Duration;

use futures::StreamExt;
use reis::ei;
use reis::event::{DeviceCapability, EiEvent, Keymap};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::{EiDevice, Granted, KeyboardLayout, Libei};

const DEVICE_DISCOVERY_DRAIN_TIMEOUT: Duration = Duration::from_millis(500);
const DEVICE_REFRESH_TIMEOUT: Duration = Duration::from_millis(1);
const DEVICE_REFRESH_LIMIT: usize = 256;

impl Libei {
    pub(super) fn discover_devices(&mut self, targets: Granted) -> CoreResult<()> {
        let mut events = self
            .events
            .take()
            .ok_or_else(|| DesktopError::input_failed("libei event stream is unavailable"))?;
        let runtime = self.runtime;
        let result = runtime.block_on(async {
            let mut drain_deadline = None;
            for _ in 0..128 {
                let next = match drain_deadline {
                    Some(deadline) => {
                        match tokio::time::timeout_at(deadline, events.next()).await {
                            Ok(event) => event,
                            Err(_) => break,
                        }
                    }
                    None => events.next().await,
                };
                let event = next
                    .ok_or_else(|| {
                        DesktopError::input_failed("libei disconnected during device discovery")
                    })?
                    .map_err(|error| {
                        DesktopError::input_failed(format!("libei device discovery: {error}"))
                    })?;
                self.handle_event(event)?;
                if discovery_complete(
                    targets,
                    self.has_capability(DeviceCapability::PointerAbsolute),
                    self.has_capability(DeviceCapability::Keyboard),
                ) {
                    break;
                }
                if drain_deadline.is_none() && self.devices.iter().any(|device| device.resumed) {
                    drain_deadline =
                        Some(tokio::time::Instant::now() + DEVICE_DISCOVERY_DRAIN_TIMEOUT);
                }
            }
            Ok(())
        });
        self.events = Some(events);
        result
    }

    pub(super) fn refresh_devices(&mut self) -> CoreResult<()> {
        let mut events = self
            .events
            .take()
            .ok_or_else(|| DesktopError::input_failed("libei event stream is unavailable"))?;
        let runtime = self.runtime;
        let result = runtime.block_on(async {
            for _ in 0..DEVICE_REFRESH_LIMIT {
                match tokio::time::timeout(DEVICE_REFRESH_TIMEOUT, events.next()).await {
                    Ok(Some(event)) => self.handle_event(event.map_err(|error| {
                        DesktopError::input_failed(format!("libei device state: {error}"))
                    })?)?,
                    Ok(None) => {
                        return Err(DesktopError::input_failed(
                            "libei disconnected while refreshing device state",
                        ))
                    }
                    Err(_) => return Ok(()),
                }
            }
            Err(DesktopError::input_failed(
                "libei device state did not settle; no input was sent",
            ))
        });
        self.events = Some(events);
        result
    }

    fn handle_event(&mut self, event: EiEvent) -> CoreResult<()> {
        match event {
            EiEvent::SeatAdded(event) => {
                event.seat.bind_capabilities(&[
                    DeviceCapability::PointerAbsolute,
                    DeviceCapability::Pointer,
                    DeviceCapability::Button,
                    DeviceCapability::Scroll,
                    DeviceCapability::Keyboard,
                ]);
                self.context.flush().map_err(|error| {
                    DesktopError::input_failed(format!("libei bind seat: {error}"))
                })?;
            }
            EiEvent::DeviceAdded(event) => {
                self.devices.push(EiDevice {
                    layout: event.device.keymap().and_then(read_keymap),
                    device: event.device,
                    serial: 0,
                    resumed: false,
                });
            }
            EiEvent::DeviceResumed(event) => {
                if let Some(device) = self
                    .devices
                    .iter_mut()
                    .find(|device| device.device == event.device)
                {
                    device.serial = event.serial;
                    device.resumed = true;
                }
            }
            EiEvent::DevicePaused(event) => {
                if let Some(device) = self
                    .devices
                    .iter_mut()
                    .find(|device| device.device == event.device)
                {
                    device.resumed = false;
                }
            }
            EiEvent::DeviceRemoved(event) => {
                self.devices.retain(|device| device.device != event.device);
            }
            EiEvent::SeatRemoved(event) => {
                self.devices
                    .retain(|device| device.device.seat() != &event.seat);
            }
            EiEvent::KeyboardModifiers(event) => {
                if let Some(layout) = self
                    .devices
                    .iter_mut()
                    .find(|device| device.device == event.device)
                    .and_then(|device| device.layout.as_mut())
                {
                    layout.update_modifiers(
                        event.depressed,
                        event.latched,
                        event.locked,
                        event.group,
                    );
                }
            }
            EiEvent::Disconnected(event) => {
                self.devices.clear();
                return Err(DesktopError::input_failed(format!(
                    "libei disconnected: {}",
                    event.explanation
                )));
            }
            _ => {}
        }
        Ok(())
    }

    fn has_capability(&self, capability: DeviceCapability) -> bool {
        self.devices
            .iter()
            .any(|device| device.resumed && device.device.has_capability(capability))
    }
}

pub(super) const fn discovery_complete(targets: Granted, pointer: bool, keyboard: bool) -> bool {
    (!targets.pointer || pointer) && (!targets.keyboard || keyboard)
}

fn read_keymap(keymap: &Keymap) -> Option<KeyboardLayout> {
    if keymap.type_ != ei::keyboard::KeymapType::Xkb || keymap.size == 0 {
        return None;
    }
    let fd = keymap.fd.as_fd().try_clone_to_owned().ok()?;
    KeyboardLayout::from_fd(fd, usize::try_from(keymap.size).ok()?)
}
