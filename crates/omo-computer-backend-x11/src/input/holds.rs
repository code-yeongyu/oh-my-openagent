//! Keys the user holds are theirs: the engine releases only the keycodes it pressed itself, never
//! a key that was already down when it started (design row L5).

use std::collections::BTreeSet;

/// The keycodes to release after a send: `ours` minus anything the user held.
#[must_use]
pub fn release_plan(ours: &BTreeSet<u8>, user_held: &BTreeSet<u8>) -> Vec<u8> {
    ours.difference(user_held).copied().collect()
}
