//! The session epoch: display reconfiguration, lock, sleep, a Space switch, an engine
//! restart, the idle flush, a Windows session or input-desktop change and a Wayland stream
//! geometry change each move it. A move supersedes every frame, expires every ref and is
//! queued as `epoch.changed{reason}` for the transports that push it.

use omo_computer_core::frame::EpochReason;
use serde::Serialize;

use crate::refs::Expiry;
use crate::Session;

/// `epoch.changed{reason}`: the epoch moved to `epoch`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct EpochChanged {
    pub reason: EpochReason,
    pub epoch: u64,
}

impl Session {
    /// Moves the epoch for `reason`.
    pub fn change_epoch(&mut self, reason: EpochReason) {
        let epoch = self.frames.bump_epoch();
        let windows: Vec<String> = self.refs.windows.keys().cloned().collect();
        for window in windows {
            self.refs.expire(&window, Expiry::Epoch);
        }
        self.frames.events.push(EpochChanged { reason, epoch });
    }

    /// The `epoch.changed` notifications not yet taken, oldest first.
    pub fn take_epoch_events(&mut self) -> Vec<EpochChanged> {
        std::mem::take(&mut self.frames.events)
    }

    /// The session epoch.
    #[must_use]
    pub const fn epoch(&self) -> u64 {
        self.frames.epoch()
    }

    /// Applies every change the backend's epoch source reports.
    pub(crate) fn poll_epoch(&mut self) {
        let mut source = self.backend.epoch_source();
        // A backend with no epoch source refuses every read: it reports no change, and its
        // frames still go stale through newer captures, the window basis and its size.
        while let Ok(Some(change)) = source.next_change() {
            let reason = EpochReason::from_wire(&change.reason).unwrap_or_else(|| {
                eprintln!(
                    "omo-computer-engine: warn unknown epoch reason {:?} read as display",
                    change.reason
                );
                EpochReason::Display
            });
            self.change_epoch(reason);
        }
    }
}
