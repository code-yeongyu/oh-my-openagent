//! Emulation: one burst per action - `start_emulating` on the device, one frame per event with
//! strictly increasing microsecond timestamps, `stop_emulating`, flush (d-linux.md 'Emulation').

use std::io::ErrorKind;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reis::ei;
use reis::event::DeviceCapability;

use super::client::{EiSession, LinkError};

/// How long a flush waits for a server that is slow to read before the burst counts as
/// interrupted.
const FLUSH_DEADLINE: Duration = Duration::from_secs(5);

/// One libei event.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Emit {
    Key {
        key: u32,
        down: bool,
    },
    Button {
        button: u32,
        down: bool,
    },
    MotionAbsolute {
        x: f32,
        y: f32,
    },
    /// Discrete scroll in 120ths of a detent.
    Scroll {
        dx: i32,
        dy: i32,
    },
}

impl Emit {
    const fn capability(self) -> DeviceCapability {
        match self {
            Self::Key { .. } => DeviceCapability::Keyboard,
            Self::Button { .. } => DeviceCapability::Button,
            Self::MotionAbsolute { .. } => DeviceCapability::PointerAbsolute,
            Self::Scroll { .. } => DeviceCapability::Scroll,
        }
    }
}

/// Monotonic microsecond timestamps, strictly increasing within the process.
#[derive(Debug, Default)]
pub struct Clock {
    last: u64,
}

impl Clock {
    fn next(&mut self) -> u64 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| {
                u64::try_from(since.as_micros()).unwrap_or(u64::MAX)
            });
        self.last = now.max(self.last + 1);
        self.last
    }
}

impl EiSession {
    /// Sends `events` as one burst per device run.
    ///
    /// # Errors
    /// [`LinkError::Lost`] when a device is missing (nothing of the burst left the engine),
    /// [`LinkError::Interrupted`] when the flush failed part-way (part of it may have landed).
    pub fn emit(
        &mut self,
        events: &[Emit],
        clock: &mut Clock,
        sequence: &mut u32,
    ) -> Result<(), LinkError> {
        for event in events {
            let device = self
                .device(event.capability())
                .ok_or(LinkError::Lost)?
                .clone();
            let serial = self.converter.0.connection().serial();
            *sequence += 1;
            device.device().start_emulating(serial, *sequence);
            match *event {
                Emit::Key { key, down } => {
                    let keyboard = device.interface::<ei::Keyboard>().ok_or(LinkError::Lost)?;
                    keyboard.key(
                        key,
                        if down {
                            ei::keyboard::KeyState::Press
                        } else {
                            ei::keyboard::KeyState::Released
                        },
                    );
                }
                Emit::Button { button, down } => {
                    let buttons = device.interface::<ei::Button>().ok_or(LinkError::Lost)?;
                    buttons.button(
                        button,
                        if down {
                            ei::button::ButtonState::Press
                        } else {
                            ei::button::ButtonState::Released
                        },
                    );
                }
                Emit::MotionAbsolute { x, y } => device
                    .interface::<ei::PointerAbsolute>()
                    .ok_or(LinkError::Lost)?
                    .motion_absolute(x, y),
                Emit::Scroll { dx, dy } => device
                    .interface::<ei::Scroll>()
                    .ok_or(LinkError::Lost)?
                    .scroll_discrete(dx, dy),
            }
            device.device().frame(serial, clock.next());
            device.device().stop_emulating(serial);
        }
        self.flush()
    }

    /// Flushes the burst on this connection. A full socket (the server is slow to read) is
    /// waited out up to [`FLUSH_DEADLINE`]: what was sent stays sent, so the rest follows on the
    /// same connection and nothing is ever sent twice.
    fn flush(&self) -> Result<(), LinkError> {
        let deadline = Instant::now() + FLUSH_DEADLINE;
        loop {
            match self.converter.0.connection().flush() {
                Ok(()) => return Ok(()),
                Err(error)
                    if std::io::Error::from(error).kind() == ErrorKind::WouldBlock
                        && self.wait_writable(deadline) => {}
                Err(_) => return Err(LinkError::Interrupted),
            }
        }
    }

    fn wait_writable(&self, deadline: Instant) -> bool {
        let left = deadline.saturating_duration_since(Instant::now());
        let millis = i32::try_from(left.as_millis()).unwrap_or(i32::MAX);
        let mut fds = [rustix::event::PollFd::new(
            &self.context,
            rustix::event::PollFlags::OUT,
        )];
        millis > 0 && rustix::event::poll(&mut fds, millis).is_ok_and(|ready| ready > 0)
    }
}
