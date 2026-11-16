//! One client of the fake EIS server: the handshake, the seat, the devices the client binds,
//! and the requests it sends, each written to the shared log.

use std::io::{Seek, Write};
use std::os::fd::AsFd;
use std::os::unix::net::UnixStream;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use reis::eis;
use reis::event::DeviceCapability;
use reis::handshake::EisHandshaker;
use reis::request::{Device, EisRequest, EisRequestConverter};
use reis::PendingRequestResult;

use super::eis::{note, Log, Script};

const CAPABILITIES: [DeviceCapability; 4] = [
    DeviceCapability::Keyboard,
    DeviceCapability::PointerAbsolute,
    DeviceCapability::Button,
    DeviceCapability::Scroll,
];

enum Stage {
    Handshake(EisHandshaker),
    Serving(EisRequestConverter),
}

pub(super) struct Client {
    context: eis::Context,
    stage: Option<Stage>,
    keyboard: Option<Device>,
    devices: Vec<Device>,
    resumed: bool,
    held: Vec<u32>,
}

impl Client {
    pub(super) fn accept(stream: UnixStream) -> std::io::Result<Self> {
        let context = eis::Context::new(stream)?;
        let handshaker = EisHandshaker::new(&context, 1);
        Ok(Self { context, stage: Some(Stage::Handshake(handshaker)), keyboard: None, devices: Vec::new(), resumed: false, held: Vec::new() })
    }

    pub(super) const fn resumed(&self) -> bool {
        self.resumed
    }

    /// Reads and answers what the client sent; `false` once its socket closed.
    pub(super) fn pump(&mut self, script: &Script, log: &Arc<Mutex<Log>>) -> bool {
        match self.context.read() {
            Ok(0) => return self.closed(log),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => return self.closed(log),
        }
        while let Some(pending) = self.context.pending_request() {
            let PendingRequestResult::Request(request) = pending else {
                return self.closed(log);
            };
            if !self.handle(request, script, log) {
                return self.closed(log);
            }
        }
        self.context.flush().is_ok() || self.closed(log)
    }

    fn handle(&mut self, request: eis::Request, script: &Script, log: &Arc<Mutex<Log>>) -> bool {
        match self.stage.take() {
            Some(Stage::Handshake(mut handshaker)) => match handshaker.handle_request(request) {
                Ok(Some(response)) => {
                    let converter = EisRequestConverter::new(&self.context, response, 1);
                    converter.handle().add_seat(Some("seat0"), &CAPABILITIES);
                    self.stage = Some(Stage::Serving(converter));
                    true
                }
                Ok(None) => {
                    self.stage = Some(Stage::Handshake(handshaker));
                    true
                }
                Err(_) => false,
            },
            Some(Stage::Serving(mut converter)) => {
                if converter.handle_request(request).is_err() {
                    return false;
                }
                while let Some(request) = converter.next_request() {
                    if !self.serve(request, script, log) {
                        return false;
                    }
                }
                self.stage = Some(Stage::Serving(converter));
                true
            }
            None => false,
        }
    }

    fn serve(&mut self, request: EisRequest, script: &Script, log: &Arc<Mutex<Log>>) -> bool {
        match request {
            EisRequest::Disconnect => return false,
            EisRequest::Bind(bind) => self.add_devices(&bind.seat, script, log),
            EisRequest::Frame(_) => note(log, |log| log.frames += 1),
            EisRequest::KeyboardKey(key) => {
                let down = key.state == eis::keyboard::KeyState::Press;
                if down {
                    self.held.push(key.key);
                } else {
                    self.held.retain(|held| *held != key.key);
                }
                let held = self.held.clone();
                note(log, |log| {
                    log.keys.push((key.key, down));
                    log.held = held;
                });
            }
            EisRequest::PointerMotionAbsolute(motion) => note(log, |log| log.motions.push((motion.dx_absolute, motion.dy_absolute))),
            EisRequest::Button(button) => note(log, |log| log.buttons.push((button.button, button.state == eis::button::ButtonState::Press))),
            _ => {}
        }
        true
    }

    fn add_devices(&mut self, seat: &reis::request::Seat, script: &Script, log: &Arc<Mutex<Log>>) {
        if script.keyboard {
            self.keyboard = keyboard(seat, &script.keymap, log);
        }
        let regions = script.regions.clone();
        let pointer = seat.add_device(Some("pointer"), eis::device::DeviceType::Virtual, &[DeviceCapability::PointerAbsolute, DeviceCapability::Button, DeviceCapability::Scroll], |device| {
            for region in &regions {
                device.device().region(region.x, region.y, region.width, region.height, 1.0);
            }
        });
        self.devices.push(pointer);
        for device in self.devices.iter().chain(self.keyboard.iter()) {
            device.resumed();
        }
        self.resumed = true;
    }

    /// The compositor's layout change: the keyboard is removed and re-added with the new keymap.
    pub(super) fn replace_keyboard(&mut self, script: &Script, log: &Arc<Mutex<Log>>) {
        let Some(old) = self.keyboard.take() else { return };
        let seat = old.seat().clone();
        old.remove();
        self.keyboard = keyboard(&seat, &script.keymap, log);
        if let Some(device) = &self.keyboard {
            device.resumed();
        }
        if self.context.flush().is_err() {
            eprintln!("fake EIS: flush after the keymap change failed");
        }
    }

    pub(super) fn send_group(&self, group: u32) {
        if let Some(keyboard) = self.keyboard.as_ref().and_then(Device::interface::<eis::Keyboard>) {
            keyboard.modifiers(1, 0, 0, 0, group);
        }
        if self.context.flush().is_err() {
            eprintln!("fake EIS: flush after the group change failed");
        }
    }

    /// The socket closed: the compositor destroys the client's devices, which releases every
    /// key they held.
    fn closed(&mut self, log: &Arc<Mutex<Log>>) -> bool {
        let now = Instant::now();
        let held = std::mem::take(&mut self.held);
        note(log, |log| {
            log.closed_at = Some(now);
            if !held.is_empty() || !log.held.is_empty() {
                log.released_at = Some(Instant::now());
            }
            log.held.clear();
        });
        false
    }
}

fn keyboard(seat: &reis::request::Seat, keymap: &str, log: &Arc<Mutex<Log>>) -> Option<Device> {
    let mut file = match rustix::fs::memfd_create("omo-fake-keymap", rustix::fs::MemfdFlags::CLOEXEC) {
        Ok(fd) => std::fs::File::from(fd),
        Err(error) => {
            eprintln!("fake EIS: keymap memfd: {error}");
            return None;
        }
    };
    let bytes = keymap.as_bytes();
    if file.write_all(bytes).and_then(|()| file.write_all(b"\0")).and_then(|()| file.rewind()).is_err() {
        return None;
    }
    let size = u32::try_from(bytes.len() + 1).ok()?;
    let device = seat.add_device(Some("keyboard"), eis::device::DeviceType::Virtual, &[DeviceCapability::Keyboard], |device| {
        if let Some(keyboard) = device.interface::<eis::Keyboard>() {
            keyboard.keymap(eis::keyboard::KeymapType::Xkb, size, file.as_fd());
        }
    });
    note(log, |log| log.keymaps_fed += 1);
    Some(device)
}
