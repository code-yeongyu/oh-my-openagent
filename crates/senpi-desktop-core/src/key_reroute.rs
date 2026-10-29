//! Physical-key routing while a background target holds the keyboard uninvited.
//! Ported from oh-my-pi 0838d2ab44 (MIT, desktop/macos/key_reroute.rs).
//!
//! Invariants: injected events never move; Secure Input and changed pointer
//! state veto new routing; repeats/releases follow their recorded press; the
//! latest action alone owns new keys; supersession preserves held pairs; once
//! disarmed, an action never starts moving fresh keys again.

use std::time::{Duration, Instant};

pub const NEW_FRONT: i64 = 2;
pub const KEY_FOCUS_TAKEN: i64 = 0x4000;
pub const KEY_FOCUS_RETURNED: i64 = 0x8000;
pub const SWITCH_MODIFIERS: u64 = 0x0010_0000 | 0x0004_0000;
const CHORD_WINDOW: Duration = Duration::from_millis(250);
pub const LINGER_MAX: Duration = Duration::from_secs(30);

pub mod audit;
mod state;
mod theft;
#[cfg(test)]
use state::{forget_lifted, RELEASE_GRACE};
pub use state::{Chord, Held, Holder, Key, Registry, Stroke, UserSignals};
pub use theft::Theft;

pub fn typed_by_user(source_pid: i64, source_user_data: i64, engine_tag: i64) -> bool {
    source_pid == 0 && source_user_data != engine_tag
}

#[cfg(test)]
mod tests;
