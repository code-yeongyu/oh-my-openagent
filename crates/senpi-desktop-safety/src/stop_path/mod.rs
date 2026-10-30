//! Stop paths: whatever can latch the [`Supervisor`] and keep it fed with
//! heartbeats. The OS `Global` listener is one per platform backend (macOS
//! CGEventTap, X11 XI2, Windows `RegisterHotKey`, Wayland GlobalShortcuts);
//! the [`HostRelay`] is the host process relaying stops and heartbeats over
//! JSON-RPC. Every listener implements [`StopPathListener`].

mod host_relay;

use std::fmt;
use std::sync::Arc;

pub use host_relay::HostRelay;

use crate::supervisor::Supervisor;

/// A stop chord as configured (`computer.stopHotkey`): lowercase key names
/// joined by `+`, e.g. `ctrl+alt+shift+escape`. Mapping names to platform
/// key codes is the listener's job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chord {
    keys: Vec<String>,
}

impl Chord {
    /// # Errors
    /// [`StopPathError::InvalidChord`] when a key name is empty.
    pub fn parse(chord: &str) -> Result<Self, StopPathError> {
        let keys: Vec<String> = chord
            .split('+')
            .map(|key| key.trim().to_ascii_lowercase())
            .collect();
        if keys.iter().any(String::is_empty) {
            return Err(StopPathError::InvalidChord(chord.to_owned()));
        }
        Ok(Self { keys })
    }

    #[must_use]
    pub fn keys(&self) -> &[String] {
        &self.keys
    }
}

impl fmt::Display for Chord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.keys.join("+"))
    }
}

/// Why a stop path could not start.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StopPathError {
    #[error("invalid stop chord '{0}': expected key names joined by '+', e.g. ctrl+alt+shift+escape")]
    InvalidChord(String),
    /// The OS refused the listener (e.g. macOS Accessibility is not granted).
    #[error("{0}")]
    PermissionDenied(String),
    /// The listener cannot run on this host; `reason` is a stable kebab-case
    /// token such as `portal-global-shortcuts-unavailable`.
    #[error("{reason}")]
    Unavailable { reason: String },
}

impl StopPathError {
    /// The stable token reported as `capabilities().stopReason`.
    #[must_use]
    pub fn reason(&self) -> &str {
        match self {
            Self::InvalidChord(_) => "invalid-chord",
            Self::PermissionDenied(_) => "permission-denied",
            Self::Unavailable { reason } => reason,
        }
    }
}

/// A stop path that registers with the supervisor, keeps its liveness and
/// heartbeat current, and latches a stop when its trigger fires.
pub trait StopPathListener {
    /// Arms the listener for `chord`. On success it has marked its
    /// [`crate::StopPathId`] live on `sup`.
    ///
    /// # Errors
    /// Why the listener cannot run; the path then stays not live.
    fn start(&mut self, chord: &Chord, sup: Arc<Supervisor>) -> Result<(), StopPathError>;
    fn is_live(&self) -> bool;
    /// Re-arms a listener the OS disabled; a no-op before `start`.
    fn restart(&mut self);
}

#[cfg(test)]
mod tests;
