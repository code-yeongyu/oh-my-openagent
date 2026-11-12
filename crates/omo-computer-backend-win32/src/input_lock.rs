//! The opt-in `computer.foreground_input_lock` (default off): while a lease holds, the low-level
//! hooks swallow every event that is not the engine's own tagged input, except physical Escape
//! (it ends the lease) and the stop chord's keys, so the user's keys cannot land mid-action and
//! the user can always stop. `BlockInput` is never used: it would also block Escape.

use crate::stop_path::{is_stop_chord_key, HookEvent, Origin, PhysicalChord, VK_ESCAPE};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockVerdict {
    Pass,
    /// The hook procedure returns 1.
    Swallow,
}

/// The hook's answer for `event`.
#[must_use]
pub fn lock_verdict(
    event: &HookEvent,
    lock_on: bool,
    lease_active: bool,
    _tracker: &PhysicalChord,
) -> LockVerdict {
    if !lock_on || !lease_active || event.origin() == Origin::Ours {
        return LockVerdict::Pass;
    }
    if event.origin() == Origin::Physical && (event.vk == VK_ESCAPE || is_stop_chord_key(event.vk))
    {
        return LockVerdict::Pass;
    }
    LockVerdict::Swallow
}
