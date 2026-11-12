//! The session epoch. Signatures only at the test-first commit.

use omo_computer_core::frame::EpochReason;
use serde::Serialize;

use crate::Session;

/// `epoch.changed{reason}`: the epoch moved to `epoch`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct EpochChanged {
    pub reason: EpochReason,
    pub epoch: u64,
}

impl Session {
    /// Signature only at the test-first commit.
    pub fn change_epoch(&mut self, reason: EpochReason) {
        let _ = reason;
    }

    /// The `epoch.changed` notifications not yet taken, oldest first.
    pub fn take_epoch_events(&mut self) -> Vec<EpochChanged> {
        std::mem::take(&mut self.epoch_events)
    }

    /// The session epoch.
    #[must_use]
    pub const fn epoch(&self) -> u64 {
        self.frames.epoch()
    }
}
