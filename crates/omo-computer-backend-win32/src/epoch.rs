//! Windows epoch sources (row 60): display change, session lock/unlock through the WTS
//! connect state, and the engine restart, each as an `epoch.changed` reason.

use omo_computer_core::frame::EpochReason;

/// `WM_WTSSESSION_CHANGE` codes the epoch source reads.
pub const WTS_SESSION_LOCK: u32 = 0x7;
pub const WTS_SESSION_UNLOCK: u32 = 0x8;

/// The epoch reason a `WM_WTSSESSION_CHANGE` with `code` raises, if any.
#[must_use]
pub fn session_change(code: u32) -> Option<EpochReason> {
    let _ = code;
    None
}

#[cfg(test)]
mod tests {
    use omo_computer_core::frame::EpochReason;

    use super::{session_change, WTS_SESSION_LOCK, WTS_SESSION_UNLOCK};

    #[test]
    fn wts_lock_emits_epoch_changed() {
        assert_eq!(session_change(WTS_SESSION_LOCK), Some(EpochReason::Lock));
        assert_eq!(session_change(WTS_SESSION_UNLOCK), Some(EpochReason::Lock));
        assert_eq!(session_change(0x1), Some(EpochReason::Session), "WTS_CONSOLE_CONNECT");
        assert_eq!(session_change(0xFF), None);
    }
}
