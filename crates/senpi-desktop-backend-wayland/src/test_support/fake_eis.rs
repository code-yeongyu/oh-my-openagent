//! A fake EIS server built on `reis::eis` (the server half of the libei
//! protocol) that announces a keyboard with a textual XKB keymap and an
//! absolute pointer over a 1920x1080 region, then records every emulated
//! event the client sends.

use std::io::{Seek, Write};
use std::os::fd::AsFd;
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread;

use reis::eis;
use reis::handshake::EisHandshaker;
use reis::request::{DeviceCapability, EisRequest, EisRequestConverter};
use reis::PendingRequestResult;
use tokio::io::unix::AsyncFd;

use super::HANG_GUARD;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Recorded {
    Key { keycode: u32, pressed: bool },
    Button { code: u32, pressed: bool },
    Motion { x: f32, y: f32 },
}

#[derive(Debug, Default, Clone)]
pub struct Log {
    pub connected: bool,
    pub events: Vec<Recorded>,
    /// `stop_emulating` requests: one per finished client burst.
    pub bursts: usize,
    pub error: Option<String>,
}

/// The keymap the keyboard announces and the XKB group it reports active.
#[derive(Clone, Copy)]
pub struct EisConfig {
    pub keymap: &'static str,
    pub group: u32,
}

type Shared = Arc<(Mutex<Log>, Condvar)>;

pub struct FakeEis {
    log: Shared,
}

impl FakeEis {
    /// Serves the one client that connects to `listener`.
    pub fn listen(listener: UnixListener, config: EisConfig) -> Self {
        Self::spawn(config, move || listener.accept().map(|(stream, _)| stream))
    }

    /// Serves `stream` (the server end of a `ConnectToEIS` socket pair).
    pub fn serve(stream: UnixStream, config: EisConfig) -> Self {
        Self::spawn(config, move || Ok(stream))
    }

    fn spawn(
        config: EisConfig,
        accept: impl FnOnce() -> std::io::Result<UnixStream> + Send + 'static,
    ) -> Self {
        let log: Shared = Arc::default();
        let served = Arc::clone(&log);
        thread::spawn(move || {
            let outcome = accept().map_err(|error| error.to_string()).and_then(|stream| {
                update(&served, |log| log.connected = true);
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|error| error.to_string())?
                    .block_on(serve(stream, config, &served))
            });
            if let Err(error) = outcome {
                update(&served, |log| log.error = Some(error));
            }
        });
        Self { log }
    }

    /// Blocks until `ready` holds for the log, bounded by the hang guard.
    pub fn wait_for(&self, ready: impl Fn(&Log) -> bool) -> Log {
        let (lock, changed) = &*self.log;
        let log = lock.lock().unwrap_or_else(PoisonError::into_inner);
        let (log, waited) = changed
            .wait_timeout_while(log, HANG_GUARD, |log| !ready(log) && log.error.is_none())
            .unwrap_or_else(PoisonError::into_inner);
        assert!(!waited.timed_out(), "fake EIS hang guard expired: {log:?}");
        log.clone()
    }
}

fn update(shared: &Shared, change: impl FnOnce(&mut Log)) {
    let (lock, changed) = &**shared;
    change(&mut lock.lock().unwrap_or_else(PoisonError::into_inner));
    changed.notify_all();
}

/// The next batch of parsed requests; `None` once the client hung up.
async fn next_requests(fd: &AsyncFd<eis::Context>) -> Result<Option<Vec<eis::Request>>, String> {
    loop {
        let mut guard = fd.readable().await.map_err(|error| error.to_string())?;
        match guard.get_inner().read() {
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => guard.clear_ready(),
            Err(error) => return Err(error.to_string()),
            Ok(_) => {
                guard.clear_ready();
                let mut requests = Vec::new();
                while let Some(pending) = guard.get_inner().pending_request() {
                    match pending {
                        PendingRequestResult::Request(request) => requests.push(request),
                        PendingRequestResult::ParseError(error) => return Err(error.to_string()),
                        PendingRequestResult::InvalidObject(_) => {}
                    }
                }
                if !requests.is_empty() {
                    return Ok(Some(requests));
                }
            }
        }
    }
}

async fn serve(stream: UnixStream, config: EisConfig, log: &Shared) -> Result<(), String> {
    let context = eis::Context::new(stream).map_err(|error| error.to_string())?;
    let fd = AsyncFd::new(context.clone()).map_err(|error| error.to_string())?;
    let mut handshaker = EisHandshaker::new(&context, 0);
    let mut converter: Option<EisRequestConverter> = None;
    let mut seat = None;
    while let Some(requests) = next_requests(&fd).await? {
        for request in requests {
            match converter.as_mut() {
                Some(converter) => converter
                    .handle_request(request)
                    .map_err(|error| error.to_string())?,
                None => {
                    if let Some(resp) = handshaker
                        .handle_request(request)
                        .map_err(|error| error.to_string())?
                    {
                        let started = EisRequestConverter::new(&context, resp, 0);
                        seat = Some(started.handle().add_seat(
                            Some("default"),
                            &[
                                DeviceCapability::Pointer,
                                DeviceCapability::PointerAbsolute,
                                DeviceCapability::Keyboard,
                                DeviceCapability::Scroll,
                                DeviceCapability::Button,
                            ],
                        ));
                        converter = Some(started);
                    }
                }
            }
        }
        let Some(converter) = converter.as_mut() else {
            context.flush().map_err(|error| error.to_string())?;
            continue;
        };
        while let Some(request) = converter.next_request() {
            match request {
                EisRequest::Bind(_) => {
                    if let Some(seat) = &seat {
                        add_devices(seat, converter.handle(), config)?;
                    }
                }
                EisRequest::KeyboardKey(key) => update(log, |log| {
                    log.events.push(Recorded::Key {
                        keycode: key.key,
                        pressed: key.state == eis::keyboard::KeyState::Press,
                    });
                }),
                EisRequest::Button(button) => update(log, |log| {
                    log.events.push(Recorded::Button {
                        code: button.button,
                        pressed: button.state == eis::button::ButtonState::Press,
                    });
                }),
                EisRequest::PointerMotionAbsolute(motion) => update(log, |log| {
                    log.events.push(Recorded::Motion {
                        x: motion.dx_absolute,
                        y: motion.dy_absolute,
                    });
                }),
                EisRequest::DeviceStopEmulating(_) => update(log, |log| log.bursts += 1),
                EisRequest::Disconnect => return Ok(()),
                _ => {}
            }
        }
        context.flush().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn add_devices(
    seat: &reis::request::Seat,
    connection: &reis::request::Connection,
    config: EisConfig,
) -> Result<(), String> {
    let mut keymap = tempfile::tempfile().map_err(|error| error.to_string())?;
    keymap
        .write_all(config.keymap.as_bytes())
        .map_err(|error| error.to_string())?;
    // The client reads the shared file description from its current offset.
    keymap.rewind().map_err(|error| error.to_string())?;
    let size = u32::try_from(config.keymap.len()).map_err(|error| error.to_string())?;
    let keyboard = seat.add_device(
        Some("keyboard"),
        eis::device::DeviceType::Virtual,
        &[DeviceCapability::Keyboard],
        |device| {
            if let Some(interface) = device.interface::<eis::Keyboard>() {
                interface.keymap(eis::keyboard::KeymapType::Xkb, size, keymap.as_fd());
            }
        },
    );
    if let Some(interface) = keyboard.interface::<eis::Keyboard>() {
        connection.with_next_serial(|serial| interface.modifiers(serial, 0, 0, 0, config.group));
    }
    keyboard.resumed();
    let pointer = seat.add_device(
        Some("pointer"),
        eis::device::DeviceType::Virtual,
        &[
            DeviceCapability::PointerAbsolute,
            DeviceCapability::Button,
            DeviceCapability::Scroll,
        ],
        |device| device.device().region(0, 0, 1920, 1080, 1.0),
    );
    pointer.resumed();
    Ok(())
}
