//! libei input: the connection (`LIBEI_SOCKET` or a RemoteDesktop portal
//! session), device discovery, and the keyboard state the compositor
//! announces. Emission lives in `libei.rs`.

mod burst;
mod keymap;
mod libei;
pub mod xkb;

use std::os::fd::AsFd;
use std::time::Duration;

use futures::StreamExt;
use reis::ei;
use reis::event::{Device, DeviceCapability, EiEvent, Keymap};
use reis::tokio::EiConvertEventStream;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use tokio::runtime::Runtime;

use crate::portal::portal_runtime;
use crate::portal::remote_desktop::{self, Granted, PortalSession};
use xkb::KeyboardLayout;

const DEVICE_DISCOVERY_DRAIN_TIMEOUT: Duration = Duration::from_millis(500);
const CONTEXT_NAME: &str = "senpi-desktop";
/// A `LIBEI_SOCKET` server makes no grant; discovery waits for both kinds.
const EVERY_DEVICE: Granted = Granted {
    pointer: true,
    keyboard: true,
};

struct EiDevice {
    device: Device,
    serial: u32,
    layout: Option<KeyboardLayout>,
}

/// A `keyboard.modifiers` event: depressed, latched, locked, group.
type ModifierEvent = (Device, [u32; 4]);

pub struct Libei {
    context: ei::Context,
    pointer: Option<EiDevice>,
    keyboard: Option<EiDevice>,
    sequence: u32,
    runtime: &'static Runtime,
    events: EiConvertEventStream,
    /// evdev keys and buttons pressed and not yet released, for `release_all`.
    held_keys: Vec<u32>,
    held_buttons: Vec<u32>,
    /// Declared last: the portal session closes after the libei context.
    _portal: Option<PortalSession>,
}

// SAFETY: `EiConvertEventStream` is `!Send` only through its converter's
// `callbacks: HashMap<ei::Callback, Box<dyn FnOnce(u64)>>` (reis 0.5.0
// event.rs:89); every other field of it and of `Libei` is `Send`. That map
// can only be filled through `EiEventConverter::add_callback_handler`, which
// `EiConvertEventStream` never exposes, so it stays empty and no non-`Send`
// value ever exists inside a `Libei`. Ported from oh-my-pi libei.rs.
unsafe impl Send for Libei {}

impl Libei {
    /// Connects lazily on the first desktop input (oh-my-pi mod.rs:142-155):
    /// `LIBEI_SOCKET` when set, else a RemoteDesktop portal session.
    ///
    /// # Errors
    /// `InputFailed` when neither path exists or the handshake fails;
    /// `PermissionDenied` when the portal or its devices are refused.
    pub fn connect() -> CoreResult<Self> {
        let runtime = portal_runtime()?;
        let (context, portal, targets) = match ei::Context::connect_to_env() {
            Ok(Some(context)) => (context, None, EVERY_DEVICE),
            Ok(None) => {
                let (stream, session, granted) = remote_desktop::connect(runtime)?;
                let context = ei::Context::new(stream)
                    .map_err(|err| DesktopError::input_failed(format!("libei portal socket: {err}")))?;
                (context, Some(session), granted)
            }
            Err(err) => return Err(DesktopError::permission_denied(format!("LIBEI_SOCKET: {err}"))),
        };
        let (_connection, mut events) = runtime
            .block_on(context.handshake_tokio(CONTEXT_NAME, ei::handshake::ContextType::Sender))
            .map_err(|err| DesktopError::input_failed(format!("libei handshake: {err}")))?;
        let (pointer, keyboard) = runtime.block_on(discover(&context, &mut events, targets))?;
        if pointer.is_none() && keyboard.is_none() {
            return Err(DesktopError::permission_denied(
                "RemoteDesktop portal granted no libei keyboard or pointer devices",
            ));
        }
        Ok(Self {
            context,
            pointer,
            keyboard,
            sequence: 1,
            runtime,
            events,
            held_keys: Vec::new(),
            held_buttons: Vec::new(),
            _portal: portal,
        })
    }

    /// Applies the modifier and group changes the compositor sent since the
    /// last read, so characters resolve through the group active now.
    fn refresh_keyboard_state(&mut self) -> CoreResult<()> {
        let events = &mut self.events;
        let keyboard = &mut self.keyboard;
        self.runtime.block_on(async {
            loop {
                let event = match tokio::time::timeout(Duration::from_millis(1), events.next()).await {
                    Ok(Some(event)) => event
                        .map_err(|err| DesktopError::input_failed(format!("libei keyboard state: {err}")))?,
                    Ok(None) => {
                        return Err(DesktopError::input_failed(
                            "libei disconnected while reading keyboard state",
                        ))
                    }
                    Err(_) => return Ok(()),
                };
                match event {
                    EiEvent::KeyboardModifiers(event) => apply_modifiers(
                        keyboard.as_mut(),
                        &(
                            event.device,
                            [event.depressed, event.latched, event.locked, event.group],
                        ),
                    ),
                    EiEvent::Disconnected(event) => {
                        return Err(DesktopError::input_failed(format!(
                            "libei disconnected: {}",
                            event.explanation
                        )))
                    }
                    _ => {}
                }
            }
        })
    }
}

fn apply_modifiers(
    keyboard: Option<&mut EiDevice>,
    (device, [depressed, latched, locked, group]): &ModifierEvent,
) {
    let Some(keyboard) = keyboard.filter(|keyboard| &keyboard.device == device) else {
        return;
    };
    if let Some(layout) = keyboard.layout.as_mut() {
        layout.update_modifiers(*depressed, *latched, *locked, *group);
    }
}

/// Binds the seat, then collects the granted devices until each is resumed,
/// draining briefly after the first so a late second device still arrives.
/// A modifier event seen before the keyboard resumes is applied to it.
async fn discover(
    context: &ei::Context,
    events: &mut EiConvertEventStream,
    targets: Granted,
) -> CoreResult<(Option<EiDevice>, Option<EiDevice>)> {
    let (mut pointer, mut keyboard) = (None, None);
    let (mut pending_pointer, mut pending_keyboard) = (None, None);
    let mut pending_modifiers: Option<ModifierEvent> = None;
    let mut drain_deadline = None;
    for _ in 0..128 {
        let next = match drain_deadline {
            Some(deadline) => match tokio::time::timeout_at(deadline, events.next()).await {
                Ok(event) => event,
                Err(_) => break,
            },
            None => events.next().await,
        };
        let event = next
            .ok_or_else(|| DesktopError::input_failed("libei disconnected during device discovery"))?
            .map_err(|err| DesktopError::input_failed(format!("libei device discovery: {err}")))?;
        match event {
            EiEvent::SeatAdded(event) => {
                event.seat.bind_capabilities(&[
                    DeviceCapability::PointerAbsolute,
                    DeviceCapability::Pointer,
                    DeviceCapability::Button,
                    DeviceCapability::Scroll,
                    DeviceCapability::Keyboard,
                ]);
                context
                    .flush()
                    .map_err(|err| DesktopError::input_failed(format!("libei bind seat: {err}")))?;
            }
            EiEvent::DeviceAdded(event) => {
                if event.device.has_capability(DeviceCapability::PointerAbsolute) {
                    pending_pointer = Some(event.device.clone());
                }
                if event.device.has_capability(DeviceCapability::Keyboard) {
                    pending_keyboard = Some(event.device);
                }
            }
            EiEvent::DeviceResumed(event) => {
                if pending_pointer.as_ref() == Some(&event.device) {
                    pointer = Some(EiDevice {
                        device: event.device.clone(),
                        serial: event.serial,
                        layout: None,
                    });
                }
                if pending_keyboard.as_ref() == Some(&event.device) {
                    let layout = event.device.keymap().and_then(read_keymap);
                    keyboard = Some(EiDevice {
                        device: event.device,
                        serial: event.serial,
                        layout,
                    });
                    if let Some(modifiers) = pending_modifiers.take() {
                        apply_modifiers(keyboard.as_mut(), &modifiers);
                    }
                }
            }
            EiEvent::KeyboardModifiers(event) => {
                let modifiers = (
                    event.device,
                    [event.depressed, event.latched, event.locked, event.group],
                );
                if keyboard.is_some() {
                    apply_modifiers(keyboard.as_mut(), &modifiers);
                } else {
                    pending_modifiers = Some(modifiers);
                }
            }
            EiEvent::Disconnected(event) => {
                return Err(DesktopError::input_failed(format!(
                    "libei disconnected: {}",
                    event.explanation
                )));
            }
            _ => {}
        }
        if discovery_complete(targets, pointer.is_some(), keyboard.is_some()) {
            break;
        }
        if drain_deadline.is_none() && (pointer.is_some() || keyboard.is_some()) {
            drain_deadline = Some(tokio::time::Instant::now() + DEVICE_DISCOVERY_DRAIN_TIMEOUT);
        }
    }
    Ok((pointer, keyboard))
}

/// Every device the grant names has resumed.
const fn discovery_complete(targets: Granted, pointer: bool, keyboard: bool) -> bool {
    (!targets.pointer || pointer) && (!targets.keyboard || keyboard)
}

fn read_keymap(keymap: &Keymap) -> Option<KeyboardLayout> {
    if keymap.type_ != ei::keyboard::KeymapType::Xkb || keymap.size == 0 {
        return None;
    }
    let fd = keymap.fd.as_fd().try_clone_to_owned().ok()?;
    KeyboardLayout::from_fd(fd, usize::try_from(keymap.size).ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_waits_for_every_granted_device() {
        let targets = EVERY_DEVICE;

        assert!(!discovery_complete(targets, false, true));
        assert!(discovery_complete(targets, true, true));
    }

    #[test]
    fn discovery_ignores_a_device_the_portal_did_not_grant() {
        let keyboard_only = Granted {
            pointer: false,
            keyboard: true,
        };
        assert!(discovery_complete(keyboard_only, false, true));
    }
}
