//! The configured stop chord as `RegisterHotKey` takes it: the `MOD_*` flags
//! of the chord's modifiers plus one layout-independent virtual key. Pure,
//! so the mapping is tested on every host.

use senpi_desktop_core::keys::{parse_key, KeyName};
use senpi_desktop_safety::{Chord, StopPathError};

use crate::input::keys::named_virtual_key;

/// Windows spelling of the default stop chord (`computer.stopHotkey`).
pub const DEFAULT_STOP_CHORD: &str = "ctrl+alt+shift+escape";

pub const MOD_ALT: u32 = 0x0001;
pub const MOD_CONTROL: u32 = 0x0002;
pub const MOD_SHIFT: u32 = 0x0004;
pub const MOD_WIN: u32 = 0x0008;
/// Holding the chord down fires once, not once per auto-repeat.
pub const MOD_NOREPEAT: u32 = 0x4000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hotkey {
    /// `MOD_*` flags of the chord's modifiers (without `MOD_NOREPEAT`).
    pub modifiers: u32,
    pub vk: u32,
}

impl Hotkey {
    /// Maps `chord` to `RegisterHotKey`'s modifiers and virtual key.
    ///
    /// # Errors
    /// [`StopPathError::InvalidChord`] unless the chord is at least one
    /// modifier plus exactly one key with a layout-independent virtual key
    /// (a named key, an ASCII letter, or a digit). A hotkey swallows its key
    /// system-wide, so a modifier-less chord would steal a plain key from
    /// every application.
    pub fn parse(chord: &Chord) -> Result<Self, StopPathError> {
        let invalid = || StopPathError::InvalidChord(chord.to_string());
        let mut modifiers = 0;
        let mut trigger = None;
        for name in chord.keys() {
            let key = parse_key(name).map_err(|_| invalid())?;
            match key {
                KeyName::Ctrl => modifiers |= MOD_CONTROL,
                KeyName::Alt => modifiers |= MOD_ALT,
                KeyName::Shift => modifiers |= MOD_SHIFT,
                KeyName::Meta => modifiers |= MOD_WIN,
                other => {
                    let vk = trigger_virtual_key(other).ok_or_else(invalid)?;
                    if trigger.replace(vk).is_some() {
                        return Err(invalid());
                    }
                }
            }
        }
        match (modifiers, trigger) {
            (0, _) | (_, None) => Err(invalid()),
            (modifiers, Some(vk)) => Ok(Self { modifiers, vk }),
        }
    }
}

/// Letters and digits share their ASCII code with their virtual key on every
/// layout; other characters move between layouts and are refused.
fn trigger_virtual_key(key: KeyName) -> Option<u32> {
    match key {
        KeyName::Char(character) if character.is_ascii_alphanumeric() => {
            Some(u32::from(character.to_ascii_uppercase()))
        }
        KeyName::Char(_) => None,
        named => named_virtual_key(named).map(u32::from),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::keys::{VK_ESCAPE, VK_F1};

    fn parse(chord: &str) -> Result<Hotkey, StopPathError> {
        Hotkey::parse(&Chord::parse(chord).unwrap())
    }

    #[test]
    fn default_chord_maps_to_ctrl_alt_shift_escape() {
        assert_eq!(
            parse(DEFAULT_STOP_CHORD),
            Ok(Hotkey {
                modifiers: MOD_CONTROL | MOD_ALT | MOD_SHIFT,
                vk: u32::from(VK_ESCAPE),
            })
        );
    }

    #[test]
    fn letters_digits_and_named_keys_are_layout_independent_triggers() {
        assert_eq!(parse("ctrl+alt+k").map(|hotkey| hotkey.vk), Ok(0x4B));
        assert_eq!(parse("win+shift+7").map(|hotkey| hotkey.vk), Ok(0x37));
        assert_eq!(
            parse("meta+f1"),
            Ok(Hotkey {
                modifiers: MOD_WIN,
                vk: u32::from(VK_F1)
            })
        );
    }

    #[test]
    fn chords_registerhotkey_cannot_hold_are_invalid() {
        for chord in [
            "escape",
            "ctrl+alt+shift",
            "ctrl+a+b",
            "ctrl+alt+;",
            "ctrl+alt+bogus",
        ] {
            assert_eq!(
                parse(chord),
                Err(StopPathError::InvalidChord(chord.to_owned())),
                "{chord}"
            );
        }
    }
}
