//! The configured stop chord as the event tap sees it: one non-modifier
//! key's virtual keycode plus the modifier flags that must all be down.

use senpi_desktop_core::backend::Modifiers;
use senpi_desktop_core::keys::parse_key;
use senpi_desktop_safety::{Chord, StopPathError};

use crate::input::{key_code, modifier_flags, update_modifier};

/// macOS spelling of the default stop chord (`computer.stopHotkey`).
pub const DEFAULT_STOP_CHORD: &str = "ctrl+opt+cmd+escape";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Hotkey {
    /// `kCGKeyboardEventKeycode` of the non-modifier key.
    keycode: i64,
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
            keycode: i64::from(code),
            flags: modifier_flags(modifiers).bits(),
        })
    }

    /// Whether a key-down with `keycode` and `flags` is this chord. Extra
    /// modifiers still match: a stop is never missed for a stray Shift.
    pub(super) const fn matches_hotkey(self, keycode: i64, flags: u64) -> bool {
        keycode == self.keycode && flags & self.flags == self.flags
    }
}
