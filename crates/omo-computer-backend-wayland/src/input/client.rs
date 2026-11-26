//! One libei connection: the handshake as a sender, the seat's capabilities bound, and the
//! devices the compositor announces - the keyboard with its keymap, the absolute pointer with
//! its regions, the button and the scroll device (d-linux.md 'Connection lifecycle').

use std::collections::HashSet;
use std::os::fd::{AsFd, AsRawFd, RawFd};
use std::os::unix::fs::FileExt;
use std::os::unix::net::UnixStream;
use std::time::{Duration, Instant};

use reis::ei;
use reis::event::{Device, DeviceCapability, EiEvent, EiEventConverter};
use reis::handshake::EiHandshaker;
use reis::PendingRequestResult;

use super::regions::Region;

const HANDSHAKE_DEADLINE: Duration = Duration::from_secs(2);
/// After the first device resumes, a short drain lets the rest of the seat arrive.
const DISCOVERY_DRAIN: Duration = Duration::from_millis(500);
const DISCOVERY_DEADLINE: Duration = Duration::from_secs(3);
const CAPABILITIES: [DeviceCapability; 4] = [
    DeviceCapability::Keyboard,
    DeviceCapability::PointerAbsolute,
    DeviceCapability::Button,
    DeviceCapability::Scroll,
];

/// Why the connection is unusable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError {
    /// The socket closed or the server disconnected us.
    Lost,
    /// The handshake or device discovery did not complete.
    Handshake(String),
}

/// A live libei connection.
/// The event converter, movable to another thread: its only non-`Send` member is the map of
/// `sync` callbacks, filled solely by `add_callback_handler`, which this crate never calls (the
/// wrapper does not expose the converter outside this module tree).
pub(super) struct Converter(pub(super) EiEventConverter);

// SAFETY: see [`Converter`]: the callback map stays empty, so no non-`Send` closure is ever
// owned; every other member (an `Arc`ed connection, device and seat maps) is `Send`.
unsafe impl Send for Converter {}

pub struct EiSession {
    pub(super) context: ei::Context,
    pub(super) converter: Converter,
    pub(super) devices: Vec<Device>,
    resumed: HashSet<Device>,
    keymap: Option<String>,
    keymap_generation: u32,
    group: u32,
}

impl EiSession {
    /// Handshakes on `stream` and waits for the seat's devices.
    ///
    /// # Errors
    /// [`LinkError::Handshake`] when the server does not complete in time, [`LinkError::Lost`]
    /// when the socket closes.
    pub fn connect(stream: UnixStream) -> Result<Self, LinkError> {
        let context =
            ei::Context::new(stream).map_err(|error| LinkError::Handshake(error.to_string()))?;
        let mut handshaker = EiHandshaker::new("omo-computer", ei::handshake::ContextType::Sender);
        let deadline = Instant::now() + HANDSHAKE_DEADLINE;
        let response = loop {
            wait_readable(&context, deadline)?;
            read(&context)?;
            let mut done = None;
            while let Some(pending) = context.pending_event() {
                let PendingRequestResult::Request(event) = pending else {
                    return Err(LinkError::Handshake("malformed handshake".to_owned()));
                };
                if let Some(response) = handshaker
                    .handle_event(event)
                    .map_err(|error| LinkError::Handshake(error.to_string()))?
                {
                    done = Some(response);
                    break;
                }
            }
            if let Some(response) = done {
                break response;
            }
        };
        let converter = Converter(EiEventConverter::new(&context, response));
        let mut session = Self {
            context,
            converter,
            devices: Vec::new(),
            resumed: HashSet::new(),
            keymap: None,
            keymap_generation: 0,
            group: 0,
        };
        session.discover()?;
        Ok(session)
    }

    fn discover(&mut self) -> Result<(), LinkError> {
        let deadline = Instant::now() + DISCOVERY_DEADLINE;
        let mut drain_until: Option<Instant> = None;
        loop {
            // Events that arrived with the handshake's last read are already buffered.
            self.pump()?;
            if drain_until.is_none() && !self.resumed.is_empty() {
                drain_until = Some(Instant::now() + DISCOVERY_DRAIN);
            }
            if self.ready() && self.keymap.is_some() {
                return Ok(());
            }
            let until = drain_until.map_or(deadline, |drain| drain.min(deadline));
            if Instant::now() >= until {
                return if self.resumed.is_empty() {
                    Err(LinkError::Handshake("no device resumed".to_owned()))
                } else {
                    Ok(())
                };
            }
            if wait_readable(&self.context, until).is_err() && Instant::now() < until {
                return Err(LinkError::Lost);
            }
        }
    }

    /// Reads whatever the server sent, without blocking.
    ///
    /// # Errors
    /// [`LinkError::Lost`] when the socket closed or the server disconnected us.
    pub fn pump(&mut self) -> Result<(), LinkError> {
        if poll(&self.context, 0) {
            read(&self.context)?;
        }
        while let Some(pending) = self.context.pending_event() {
            let PendingRequestResult::Request(event) = pending else {
                return Err(LinkError::Lost);
            };
            self.converter
                .0
                .handle_event(event)
                .map_err(|_| LinkError::Lost)?;
        }
        while let Some(event) = self.converter.0.next_event() {
            self.apply(event)?;
        }
        Ok(())
    }

    fn apply(&mut self, event: EiEvent) -> Result<(), LinkError> {
        match event {
            EiEvent::Disconnected(_) => return Err(LinkError::Lost),
            EiEvent::SeatAdded(added) => {
                added.seat.bind_capabilities(&CAPABILITIES);
                self.converter
                    .0
                    .connection()
                    .flush()
                    .map_err(|_| LinkError::Lost)?;
            }
            EiEvent::DeviceAdded(added) => {
                if let Some(text) = added.device.keymap().and_then(read_keymap) {
                    self.keymap = Some(text);
                    self.keymap_generation += 1;
                }
                self.devices.push(added.device);
            }
            EiEvent::DeviceRemoved(removed) => {
                self.resumed.remove(&removed.device);
                self.devices.retain(|device| *device != removed.device);
            }
            EiEvent::DeviceResumed(resumed) => {
                self.resumed.insert(resumed.device);
            }
            EiEvent::DevicePaused(paused) => {
                self.resumed.remove(&paused.device);
            }
            EiEvent::KeyboardModifiers(modifiers) => self.group = modifiers.group,
            _ => {}
        }
        Ok(())
    }

    /// The resumed device carrying `capability`.
    #[must_use]
    pub fn device(&self, capability: DeviceCapability) -> Option<&Device> {
        self.devices
            .iter()
            .find(|device| device.has_capability(capability) && self.resumed.contains(*device))
    }

    /// A keyboard and an absolute pointer are resumed.
    #[must_use]
    pub fn ready(&self) -> bool {
        self.device(DeviceCapability::Keyboard).is_some()
            && self.device(DeviceCapability::PointerAbsolute).is_some()
    }

    /// The regions of the absolute pointer, in logical pixels.
    #[must_use]
    pub fn regions(&self) -> Vec<Region> {
        self.device(DeviceCapability::PointerAbsolute)
            .map(|device| {
                device
                    .regions()
                    .iter()
                    .map(|region| Region {
                        x: region.x,
                        y: region.y,
                        width: region.width,
                        height: region.height,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The keymap text the compositor fed last, and how many it has fed.
    #[must_use]
    pub fn keymap(&self) -> (Option<&str>, u32) {
        (self.keymap.as_deref(), self.keymap_generation)
    }

    /// The active group the keyboard's last modifiers event reported.
    #[must_use]
    pub const fn group(&self) -> u32 {
        self.group
    }

    #[must_use]
    pub fn raw_fd(&self) -> RawFd {
        self.context.as_raw_fd()
    }
}

fn read_keymap(keymap: &reis::event::Keymap) -> Option<String> {
    let file = std::fs::File::from(keymap.fd.try_clone().ok()?);
    let mut bytes = vec![0; usize::try_from(keymap.size).ok()?];
    file.read_exact_at(&mut bytes, 0).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    Some(text.trim_end_matches('\0').to_owned())
}

/// Reads what is buffered. `reis` answers `Ok(0)` when nothing is waiting and
/// `UnexpectedEof` when the socket closed.
fn read(context: &ei::Context) -> Result<(), LinkError> {
    match context.read() {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(()),
        Err(_) => Err(LinkError::Lost),
    }
}

fn poll(context: &ei::Context, timeout_ms: i32) -> bool {
    let mut fds = [rustix::event::PollFd::new(
        context,
        rustix::event::PollFlags::IN,
    )];
    rustix::event::poll(&mut fds, timeout_ms).is_ok_and(|ready| ready > 0)
}

fn wait_readable(context: &ei::Context, deadline: Instant) -> Result<(), LinkError> {
    let left = deadline.saturating_duration_since(Instant::now());
    let millis = i32::try_from(left.as_millis()).unwrap_or(i32::MAX);
    if millis == 0 || !poll(context, millis) {
        return Err(LinkError::Handshake("timed out".to_owned()));
    }
    Ok(())
}

impl AsFd for EiSession {
    fn as_fd(&self) -> std::os::fd::BorrowedFd<'_> {
        self.context.as_fd()
    }
}
