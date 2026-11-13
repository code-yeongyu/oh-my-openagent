//! The X11 global stop path (`design/d-safety.md` '1. The physical stop chord'): an XI2 raw-key
//! listener on a connection of its own hears the stop chord from a physical keyboard whichever
//! client has focus or a grab, never from an XTEST device. Every poll is a heartbeat round trip;
//! a broken connection reads as gone, so the supervisor's bounded ladder re-arms it and parks
//! it when the ladder is spent. A server whose raw events a grab could swallow (XI < 2.1), or
//! on which the listener cannot be armed, yields a DEAF listener: every poll refuses `deaf`.

mod chord;
mod live;
mod server;
mod source;
mod xi2;

#[cfg(test)]
pub(crate) mod fake;
#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use omo_computer_core::backend::{BackendResult, Refusal, StopListener};
use omo_computer_core::capabilities::DeafReason;
use omo_computer_core::error::{EngineCode, Reason};

use chord::{ChordCodes, Hotkey, Press, Pressed};
pub use chord::{ChordError, DEFAULT_STOP_CHORD};
pub use live::Live;
pub use server::{DeviceFacts, KeyMap, Lost, RawKey, RawKeyServer};
use source::Sources;
pub use xi2::Xi2Server;

/// XI 2.0 withholds raw events while another client grabs the keyboard, so a grab would
/// swallow the chord; XI 2.1 delivers them anyway.
#[must_use]
pub const fn raw_events_survive_grabs(major: u16, minor: u16) -> bool {
    major > 2 || (major == 2 && minor >= 1)
}

/// The bare physical Escapes the listener heard and the session has not taken yet; each ends
/// the foreground lease once.
#[derive(Debug, Clone, Default)]
pub struct LeaseEndSignal(Arc<AtomicU64>);

impl LeaseEndSignal {
    fn raise(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }

    /// Whether an Escape is pending; taking it consumes every pending one.
    #[must_use]
    pub fn take(&self) -> bool {
        self.0.swap(0, Ordering::SeqCst) > 0
    }
}

/// What arming on one connection produced.
pub enum Armed {
    Live(X11StopListener),
    Deaf(DeafReason),
}

/// Arms the raw listener on `server` for `chord`.
///
/// # Errors
/// [`Lost`] when the connection broke while arming.
pub fn arm(
    mut server: Box<dyn RawKeyServer>,
    chord: &str,
    lease_end: LeaseEndSignal,
) -> Result<Armed, Lost> {
    let (major, minor) = server.xi_version()?;
    if !raw_events_survive_grabs(major, minor) || server.select_raw_keys().is_err() {
        return Ok(Armed::Deaf(DeafReason::Xi2RawUnavailable));
    }
    let keymap = server.keymap()?;
    let Ok(codes) = Hotkey::parse(chord).and_then(|hotkey| hotkey.resolve(&keymap)) else {
        return Ok(Armed::Deaf(DeafReason::Xi2RawUnavailable));
    };
    Ok(Armed::Live(X11StopListener {
        server,
        codes,
        pressed: Pressed::default(),
        sources: Sources::default(),
        lease_end,
        xtest_ignored: 0,
    }))
}

fn gone() -> Refusal {
    Refusal::bare(EngineCode::StopPathUnavailable)
}

/// A listener that exists and cannot hear: every poll refuses `deaf`.
#[derive(Debug, Clone, Copy, Default)]
pub struct DeafListener;

impl StopListener for DeafListener {
    fn poll_stop(&mut self) -> BackendResult<bool> {
        Err(Refusal::new(
            EngineCode::StopPathUnavailable,
            Reason::Deaf.wire(),
        ))
    }
}

/// The armed raw listener.
pub struct X11StopListener {
    server: Box<dyn RawKeyServer>,
    codes: ChordCodes,
    pressed: Pressed,
    sources: Sources,
    lease_end: LeaseEndSignal,
    xtest_ignored: u64,
}

impl X11StopListener {
    /// Key presses ignored because an XTEST (or undescribed) device sent them.
    #[must_use]
    pub const fn xtest_ignored(&self) -> u64 {
        self.xtest_ignored
    }

    fn heard(&mut self, key: RawKey) -> bool {
        match key {
            RawKey::HierarchyChanged => self.sources.clear(),
            RawKey::Press { device, code } => {
                if !self.sources.is_physical(self.server.as_mut(), device) {
                    self.xtest_ignored += 1;
                    return false;
                }
                match self.pressed.press(code, &self.codes) {
                    Press::Stop => return true,
                    Press::LeaseEnd => self.lease_end.raise(),
                    Press::Other => {}
                }
            }
            RawKey::Release { device, code } => {
                if self.sources.is_physical(self.server.as_mut(), device) {
                    self.pressed.release(code);
                }
            }
        }
        false
    }
}

impl StopListener for X11StopListener {
    /// Drains the raw events queued since the last poll; `true` when the chord went down on a
    /// physical keyboard.
    fn poll_stop(&mut self) -> BackendResult<bool> {
        if !self.server.answers() {
            return Err(gone());
        }
        let mut stopped = false;
        while let Some(key) = self.server.next_raw_key().map_err(|Lost| gone())? {
            stopped |= self.heard(key);
        }
        Ok(stopped)
    }
}
