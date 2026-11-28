//! A direct `zwlr_virtual_pointer_v1` client: the Wayland wire protocol by
//! hand over the socket `WAYLAND_DISPLAY` names, no wayland-client
//! dependency — registry, bind, create, then `motion_absolute`, `button`,
//! `axis` and `frame`. Version 1 of the interface carries every request
//! used here. The connection stays open for the backend's lifetime, so
//! button state persists; a compositor that goes away fails input with the
//! transport error and nothing is silently held (button presses are tracked
//! and released on `release_all`).

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError};

const WL_DISPLAY: u32 = 1;
const REGISTRY: u32 = 2;
const POINTER_MANAGER: u32 = 3;
const SEAT: u32 = 4;
const BIND_CALLBACK: u32 = 5;
const POINTER: u32 = 6;
const CREATE_CALLBACK: u32 = 7;
const MANAGER_INTERFACE: &str = "zwlr_virtual_pointer_manager_v1";
const SEAT_INTERFACE: &str = "wl_seat";
/// Version 1 already defines motion_absolute, button, axis and frame.
const BIND_VERSION: u32 = 1;
/// Bound on one handshake read, so a dead compositor cannot hang input.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(2);
/// Bound on one event read during the handshake.
const EVENT_LIMIT: usize = 64 * 1024;

// wl_display requests
const DISPLAY_SYNC: u32 = 0;
const DISPLAY_GET_REGISTRY: u32 = 1;
// wl_display events: error comes first in the interface, delete_id second.
const DISPLAY_ERROR: u32 = 0;
// wl_registry
const REGISTRY_BIND: u32 = 0;
const REGISTRY_GLOBAL: u32 = 0;
// wl_callback event
const CALLBACK_DONE: u32 = 0;
// zwlr_virtual_pointer_manager_v1 request
const MANAGER_CREATE_VIRTUAL_POINTER: u32 = 0;
// zwlr_virtual_pointer_v1 requests
const POINTER_MOTION_ABSOLUTE: u32 = 1;
const POINTER_BUTTON: u32 = 2;
const POINTER_AXIS: u32 = 3;
const POINTER_FRAME: u32 = 4;

/// Linux input button codes the `button` request takes.
pub const BTN_LEFT: u32 = 0x110;
pub const BTN_RIGHT: u32 = 0x111;
pub const BTN_MIDDLE: u32 = 0x112;
const PRESSED: u32 = 1;
const RELEASED: u32 = 0;
/// `wl_pointer.axis`: 0 vertical, 1 horizontal.
const AXIS_VERTICAL: u32 = 0;
const AXIS_HORIZONTAL: u32 = 1;

fn put_u32(payload: &mut Vec<u8>, value: u32) {
    payload.extend_from_slice(&value.to_le_bytes());
}

fn put_fixed(payload: &mut Vec<u8>, value: f64) {
    let raw = (value * 256.0)
        .round()
        .clamp(i32::MIN as f64, i32::MAX as f64) as i32;
    payload.extend_from_slice(&raw.to_le_bytes());
}

fn put_string(payload: &mut Vec<u8>, text: &str) {
    put_u32(payload, u32::try_from(text.len() + 1).unwrap_or(u32::MAX));
    payload.extend_from_slice(text.as_bytes());
    payload.push(0);
    while !payload.len().is_multiple_of(4) {
        payload.push(0);
    }
}

fn message(object: u32, opcode: u32, payload: &[u8]) -> Vec<u8> {
    let size = u32::try_from(payload.len() + 8).unwrap_or(u32::MAX);
    let mut frame = Vec::with_capacity(payload.len() + 8);
    frame.extend_from_slice(&object.to_le_bytes());
    frame.extend_from_slice(&((size << 16) | opcode).to_le_bytes());
    frame.extend_from_slice(payload);
    frame
}

struct Incoming {
    object: u32,
    opcode: u32,
    payload: Vec<u8>,
}

fn read_message(stream: &mut UnixStream) -> std::io::Result<Incoming> {
    let mut header = [0u8; 8];
    stream.read_exact(&mut header)?;
    let object = u32::from_le_bytes(header[..4].try_into().expect("four bytes"));
    let word = u32::from_le_bytes(header[4..].try_into().expect("four bytes"));
    let opcode = word & 0xFFFF;
    let size = usize::try_from(word >> 16).unwrap_or(0);
    let length = size.saturating_sub(8).min(EVENT_LIMIT);
    let mut payload = vec![0u8; length];
    stream.read_exact(&mut payload)?;
    Ok(Incoming {
        object,
        opcode,
        payload,
    })
}

/// The globals the handshake needs, by name.
#[derive(Debug, Default)]
struct Globals {
    manager: Option<u32>,
    seat: Option<u32>,
}

impl Globals {
    fn complete(&self) -> bool {
        self.manager.is_some() && self.seat.is_some()
    }
}

fn parse_global(payload: &[u8]) -> Option<(u32, String)> {
    if payload.len() < 8 {
        return None;
    }
    let name = u32::from_le_bytes(payload[..4].try_into().expect("four bytes"));
    let length = u32::from_le_bytes(payload[4..8].try_into().expect("four bytes")) as usize;
    let bytes = payload.get(8..8 + length.saturating_sub(1))?;
    Some((name, String::from_utf8_lossy(bytes).into_owned()))
}

fn parse_error(payload: &[u8]) -> String {
    if payload.len() < 12 {
        return "protocol error".to_owned();
    }
    let object = u32::from_le_bytes(payload[..4].try_into().expect("four bytes"));
    let code = u32::from_le_bytes(payload[4..8].try_into().expect("four bytes"));
    let length = u32::from_le_bytes(payload[8..12].try_into().expect("four bytes")) as usize;
    let text = payload
        .get(12..12 + length.saturating_sub(1))
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
        .unwrap_or_default();
    format!("object {object} code {code}: {text}")
}

/// The `WAYLAND_DISPLAY` socket: an absolute path, or a name under
/// `XDG_RUNTIME_DIR`.
///
/// # Errors
/// `InputFailed` naming which variable is missing.
pub fn wayland_socket_path(
    env: &dyn Fn(&str) -> Option<std::ffi::OsString>,
) -> CoreResult<PathBuf> {
    let display = env("WAYLAND_DISPLAY")
        .map(PathBuf::from)
        .ok_or_else(|| DesktopError::input_failed("WAYLAND_DISPLAY is not set"))?;
    if display.is_absolute() {
        return Ok(display);
    }
    let runtime = env("XDG_RUNTIME_DIR").map(PathBuf::from).ok_or_else(|| {
        DesktopError::input_failed("XDG_RUNTIME_DIR is not set for a relative WAYLAND_DISPLAY")
    })?;
    Ok(runtime.join(display))
}

pub struct VirtualPointer {
    stream: UnixStream,
    started: Instant,
    buttons_held: Vec<u32>,
}

impl VirtualPointer {
    /// Connects to the compositor and creates one virtual pointer on the
    /// default seat. `socket` overrides `WAYLAND_DISPLAY` (tests).
    ///
    /// # Errors
    /// `InputFailed` when the socket cannot be connected, the compositor
    /// does not support the protocol, or the handshake fails.
    pub fn connect(socket: Option<&Path>) -> CoreResult<Self> {
        let path = match socket {
            Some(path) => path.to_path_buf(),
            None => wayland_socket_path(&|name| std::env::var_os(name))?,
        };
        let mut stream = UnixStream::connect(&path).map_err(|error| {
            DesktopError::input_failed(format!("wayland socket {}: {error}", path.display()))
        })?;
        stream
            .set_read_timeout(Some(HANDSHAKE_TIMEOUT))
            .map_err(|error| {
                DesktopError::input_failed(format!("wayland socket read timeout: {error}"))
            })?;
        let pointer = Self::handshake(&mut stream, &path)?;
        stream.set_read_timeout(None).ok();
        Ok(pointer)
    }

    fn send(&mut self, opcode: u32, payload: &[u8]) -> CoreResult<()> {
        self.stream
            .write_all(&message(POINTER, opcode, payload))
            .and_then(|_| self.stream.flush())
            .map_err(|error| DesktopError::input_failed(format!("virtual pointer write: {error}")))
    }

    fn handshake(stream: &mut UnixStream, path: &Path) -> CoreResult<Self> {
        let failed =
            |what: String| DesktopError::input_failed(format!("virtual pointer handshake: {what}"));
        stream
            .write_all(&message(
                WL_DISPLAY,
                DISPLAY_GET_REGISTRY,
                &REGISTRY.to_le_bytes(),
            ))
            .and_then(|_| stream.flush())
            .map_err(|error| failed(format!("{}: {error}", path.display())))?;
        // The compositor flushes the registry burst with the request, so the
        // globals arrive without a sync round trip (the flow wtype uses).
        let mut globals = Globals::default();
        while !globals.complete() {
            let incoming = match read_message(stream) {
                Ok(incoming) => incoming,
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    // The registry burst is over without the manager.
                    if globals.seat.is_some() {
                        return Err(failed(
                            "the compositor does not advertise zwlr_virtual_pointer_manager_v1"
                                .to_owned(),
                        ));
                    }
                    return Err(failed(error.to_string()));
                }
                Err(error) => return Err(failed(error.to_string())),
            };
            match (incoming.object, incoming.opcode) {
                (REGISTRY, REGISTRY_GLOBAL) => {
                    if let Some((name, interface)) = parse_global(&incoming.payload) {
                        match interface.as_str() {
                            MANAGER_INTERFACE => globals.manager = Some(name),
                            SEAT_INTERFACE => globals.seat = Some(name),
                            _ => {}
                        }
                    }
                }
                (WL_DISPLAY, DISPLAY_ERROR) => return Err(failed(parse_error(&incoming.payload))),
                _ => {}
            }
        }
        let bind = |name: u32, interface: &str, id: u32| {
            let mut payload = Vec::new();
            put_u32(&mut payload, name);
            put_string(&mut payload, interface);
            put_u32(&mut payload, BIND_VERSION);
            put_u32(&mut payload, id);
            message(REGISTRY, REGISTRY_BIND, &payload)
        };
        let mut create = Vec::new();
        put_u32(&mut create, SEAT);
        put_u32(&mut create, POINTER);
        stream
            .write_all(&bind(
                globals.manager.expect("manager global"),
                MANAGER_INTERFACE,
                POINTER_MANAGER,
            ))
            .and_then(|_| {
                stream.write_all(&bind(
                    globals.seat.expect("seat global"),
                    SEAT_INTERFACE,
                    SEAT,
                ))
            })
            .and_then(|_| {
                stream.write_all(&message(
                    WL_DISPLAY,
                    DISPLAY_SYNC,
                    &BIND_CALLBACK.to_le_bytes(),
                ))
            })
            .and_then(|_| stream.flush())
            .map_err(|error| failed(error.to_string()))?;
        // sway requires a bound seat in create_virtual_pointer: a null seat
        // is refused with invalid arguments.
        stream
            .write_all(&message(
                POINTER_MANAGER,
                MANAGER_CREATE_VIRTUAL_POINTER,
                &create,
            ))
            .and_then(|_| {
                stream.write_all(&message(
                    WL_DISPLAY,
                    DISPLAY_SYNC,
                    &CREATE_CALLBACK.to_le_bytes(),
                ))
            })
            .and_then(|_| stream.flush())
            .map_err(|error| failed(error.to_string()))?;
        for callback in [BIND_CALLBACK, CREATE_CALLBACK] {
            loop {
                let incoming = read_message(stream).map_err(|error| failed(error.to_string()))?;
                match (incoming.object, incoming.opcode) {
                    (WL_DISPLAY, DISPLAY_ERROR) => {
                        return Err(failed(parse_error(&incoming.payload)))
                    }
                    (object, CALLBACK_DONE) if object == callback => break,
                    _ => {}
                }
            }
        }
        Ok(Self {
            stream: stream
                .try_clone()
                .map_err(|error| failed(error.to_string()))?,
            started: Instant::now(),
            buttons_held: Vec::new(),
        })
    }

    fn time(&self) -> u32 {
        u32::try_from(self.started.elapsed().as_millis()).unwrap_or(u32::MAX)
    }

    /// Moves the pointer to the absolute logical point `(x, y)` within an
    /// `(x_extent, y_extent)` layout, framed so the compositor commits it.
    ///
    /// # Errors
    /// `InputFailed` when the connection broke.
    pub fn motion_absolute(
        &mut self,
        x: u32,
        y: u32,
        x_extent: u32,
        y_extent: u32,
    ) -> CoreResult<()> {
        let mut payload = Vec::with_capacity(20);
        put_u32(&mut payload, self.time());
        put_u32(&mut payload, x);
        put_u32(&mut payload, y);
        put_u32(&mut payload, x_extent);
        put_u32(&mut payload, y_extent);
        self.send(POINTER_MOTION_ABSOLUTE, &payload)?;
        self.frame()
    }

    /// Presses or releases a button code, tracked so `release_all` can lift
    /// what a failed sequence left down.
    ///
    /// # Errors
    /// `InputFailed` when the connection broke.
    pub fn button(&mut self, code: u32, down: bool) -> CoreResult<()> {
        let mut payload = Vec::with_capacity(12);
        put_u32(&mut payload, self.time());
        put_u32(&mut payload, code);
        put_u32(&mut payload, if down { PRESSED } else { RELEASED });
        self.send(POINTER_BUTTON, &payload)?;
        if down {
            self.buttons_held.push(code);
        } else {
            self.buttons_held.retain(|held| *held != code);
        }
        self.frame()
    }

    /// Scrolls by `(dx, dy)` logical wheel notches around the pointer.
    ///
    /// # Errors
    /// `InputFailed` when the connection broke.
    pub fn scroll(&mut self, dx: f64, dy: f64) -> CoreResult<()> {
        let time = self.time();
        let mut vertical = Vec::with_capacity(12);
        put_u32(&mut vertical, time);
        put_u32(&mut vertical, AXIS_VERTICAL);
        put_fixed(&mut vertical, dy);
        let mut horizontal = Vec::with_capacity(12);
        put_u32(&mut horizontal, time);
        put_u32(&mut horizontal, AXIS_HORIZONTAL);
        put_fixed(&mut horizontal, dx);
        self.send(POINTER_AXIS, &vertical)?;
        if dx != 0.0 {
            self.send(POINTER_AXIS, &horizontal)?;
        }
        self.frame()
    }

    fn frame(&mut self) -> CoreResult<()> {
        self.send(POINTER_FRAME, &[])
    }

    /// Lifts every button this client pressed.
    ///
    /// # Errors
    /// `InputFailed` when the connection broke.
    pub fn release_all(&mut self) -> CoreResult<()> {
        for code in std::mem::take(&mut self.buttons_held) {
            self.button(code, false)?;
        }
        Ok(())
    }
}
