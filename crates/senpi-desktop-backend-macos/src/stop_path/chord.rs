//! The configured stop chord as the event tap sees it: one non-modifier
//! key's virtual keycode plus the modifier flags that must all be down.

use senpi_desktop_core::backend::Modifiers;
use senpi_desktop_core::keys::parse_key;
use senpi_desktop_safety::{Chord, StopPathError};

use crate::input::{key_code, modifier_flags, update_modifier};
use std::sync::atomic::{AtomicU64, Ordering};

/// macOS spelling of the default stop chord (`computer.stopHotkey`).
pub const DEFAULT_STOP_CHORD: &str = "ctrl+opt+cmd+escape";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Hotkey {
    /// `kCGKeyboardEventKeycode` of the non-modifier key.
    keycode: u16,
    /// `CGEventFlags` bits of every modifier in the chord.
    flags: u64,
}

impl Hotkey {
    /// Maps `chord` to its keycode and modifier mask. Accepts the core key
    /// names plus the macOS `opt` alias for `option`/`alt`.
    ///
    /// # Errors
    /// [`StopPathError::InvalidChord`] unless the chord is modifiers plus
    /// exactly one key with a macOS keycode: a key-down tap never sees a
    /// modifier-only chord.
    pub(super) fn parse(chord: &Chord) -> Result<Self, StopPathError> {
        let invalid = || StopPathError::InvalidChord(chord.to_string());
        let mut modifiers = Modifiers::default();
        let mut trigger = None;
        for name in chord.keys() {
            let key = parse_key(if name == "opt" { "option" } else { name }).map_err(|_| invalid())?;
            if key.is_modifier() {
                update_modifier(&mut modifiers, key, true);
            } else if trigger.replace(key).is_some() {
                return Err(invalid());
            }
        }
        let code = key_code(trigger.ok_or_else(invalid)?).map_err(|_| invalid())?;
        Ok(Self {
            keycode: code,
            flags: modifier_flags(modifiers).bits(),
        })
    }

    /// Whether a key-down with `keycode` and `flags` is this chord. Extra
    /// modifiers still match: a stop is never missed for a stray Shift.
    pub(super) fn matches_hotkey(self, keycode: i64, flags: u64) -> bool {
        keycode == i64::from(self.keycode) && flags & self.flags == self.flags
    }
}

/// Keycode and supported modifier flags fit in one word, so the callback
/// never waits for a configuration update or sees half of a new chord.
pub(super) struct AtomicHotkey(AtomicU64);

impl AtomicHotkey {
    pub(super) fn new(hotkey: Hotkey) -> Self {
        Self(AtomicU64::new(u64::from(hotkey.keycode) | (hotkey.flags << 16)))
    }

    pub(super) fn store(&self, hotkey: Hotkey) {
        self.0.store(u64::from(hotkey.keycode) | (hotkey.flags << 16), Ordering::SeqCst);
    }

    pub(super) fn matches(&self, keycode: i64, flags: u64) -> bool {
        let packed = self.0.load(Ordering::SeqCst);
        let bytes = packed.to_le_bytes();
        let expected = u16::from_le_bytes([bytes[0], bytes[1]]);
        Hotkey { keycode: expected, flags: packed >> 16 }.matches_hotkey(keycode, flags)
    }
}
