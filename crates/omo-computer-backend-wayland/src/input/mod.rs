//! libei input: one connection owner per engine, connected lazily on the first input call (or
//! a read of its state on the socket route, which costs no dialog), reconnected within a bound,
//! with the compositor's keymap re-read whenever the compositor feeds a new one.

mod client;
mod emit;
mod fd;
mod link;
mod regions;

use omo_computer_core::backend::Refusal;
use omo_computer_core::params::Point;

pub use client::{EiSession, LinkError};
pub use emit::{Clock, Emit};
pub use fd::{describe, EisFd};
pub use link::{libei_lost, Link, RECONNECT_BACKOFF_MS};
pub use regions::{preflight, Region};

use crate::xkb::Keymap;

/// The connection owner.
pub struct Input {
    pub(crate) link: Link,
    session: Option<EiSession>,
    connected_once: bool,
    keymap: Option<(u32, Keymap)>,
    pub(crate) reconnects: u32,
    clock: Clock,
    sequence: u32,
    pub(crate) last_point: Option<Point>,
}

impl Input {
    #[must_use]
    pub fn new(link: Link) -> Self {
        Self {
            link,
            session: None,
            connected_once: false,
            keymap: None,
            reconnects: 0,
            clock: Clock::default(),
            sequence: 0,
            last_point: None,
        }
    }

    /// The live session, connecting or reconnecting as needed.
    ///
    /// # Errors
    /// `Internal{input_unsupported}` when the first connection fails, `Internal{libei_lost}`
    /// when a lost connection does not come back within the bound; nothing sent either way.
    pub fn session(&mut self) -> Result<&mut EiSession, Refusal> {
        if let Some(session) = self.session.as_mut() {
            if session.pump().is_ok() {
                return self.refreshed();
            }
            self.session = None;
        }
        let session = if self.connected_once {
            let session = self.link.reconnect(&std::thread::sleep)?;
            self.reconnects += 1;
            session
        } else {
            self.link.connect()?
        };
        self.connected_once = true;
        self.session = Some(session);
        self.refreshed()
    }

    /// Re-reads the keymap when the compositor fed a new one (a layout change).
    fn refreshed(&mut self) -> Result<&mut EiSession, Refusal> {
        let session = self.session.as_mut().ok_or_else(libei_lost)?;
        let (text, generation) = session.keymap();
        let stale = self
            .keymap
            .as_ref()
            .is_none_or(|(seen, _)| *seen != generation);
        if stale {
            self.keymap = text
                .and_then(Keymap::compile)
                .map(|keymap| (generation, keymap));
        }
        Ok(session)
    }

    /// The session and its compiled keymap together.
    ///
    /// # Errors
    /// As [`Input::session`].
    pub fn with_keymap(&mut self) -> Result<(&mut EiSession, Option<&mut Keymap>), Refusal> {
        self.session()?;
        let session = self.session.as_mut().ok_or_else(libei_lost)?;
        Ok((session, self.keymap.as_mut().map(|(_, keymap)| keymap)))
    }

    /// Sends `events`. A burst that failed before anything left the engine (a device gone) is
    /// retried once on a reconnected session; a flush that failed part-way is never resent,
    /// since part of it may have landed (review L3 of #13909).
    ///
    /// # Errors
    /// As [`Input::session`], or `Internal{libei_lost}` when the burst could not go out.
    pub fn emit(&mut self, events: &[Emit]) -> Result<(), Refusal> {
        for _ in 0..2 {
            self.session()?;
            let Some(session) = self.session.as_mut() else {
                break;
            };
            match session.emit(events, &mut self.clock, &mut self.sequence) {
                Ok(()) => return Ok(()),
                Err(LinkError::Interrupted) => {
                    self.session = None;
                    return Err(libei_lost());
                }
                Err(LinkError::Lost | LinkError::Handshake(_)) => self.session = None,
            }
        }
        Err(libei_lost())
    }

    /// The connection's state without connecting.
    #[must_use]
    pub fn current(&self) -> Option<&EiSession> {
        self.session.as_ref()
    }

    #[must_use]
    pub fn keymap(&self) -> Option<&Keymap> {
        self.keymap.as_ref().map(|(_, keymap)| keymap)
    }
}
