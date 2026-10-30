//! The stop chord as XI2 raw key events see it. Raw events carry keycodes
//! and no modifier state, so the listener tracks which keycodes are down and
//! fires when the trigger key goes down while every chord modifier is held.

use std::collections::BTreeSet;

use senpi_desktop_core::keys::parse_key;
use senpi_desktop_safety::{Chord, StopPathError};

use crate::input::{keysym_variants, Keymap};

/// X11 spelling of the default stop chord (`computer.stopHotkey` on Linux).
pub const DEFAULT_STOP_CHORD: &str = "ctrl+alt+shift+escape";

/// The chord as keysyms: one trigger key and the modifiers that must be held.
/// Each entry lists every keysym that counts (left/right sides).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hotkey {
    trigger: Vec<u32>,
    modifiers: Vec<Vec<u32>>,
}

impl Hotkey {
    /// # Errors
    /// [`StopPathError::InvalidChord`] unless the chord is modifiers plus
    /// exactly one non-modifier key.
    pub fn parse(chord: &Chord) -> Result<Self, StopPathError> {
        let invalid = || StopPathError::InvalidChord(chord.to_string());
        let mut trigger = None;
        let mut modifiers = Vec::new();
        for name in chord.keys() {
            let key = parse_key(if name == "opt" { "option" } else { name }).map_err(|_| invalid())?;
            if key.is_modifier() {
                modifiers.push(keysym_variants(key));
            } else if trigger.replace(keysym_variants(key)).is_some() {
                return Err(invalid());
            }
        }
        Ok(Self {
            trigger: trigger.ok_or_else(invalid)?,
            modifiers,
        })
    }

    /// The keycodes of this chord on `keymap`.
    ///
    /// # Errors
    /// [`StopPathError::Unavailable`] when a chord key has no keycode, so
    /// the chord could never be typed.
    pub fn resolve(&self, keymap: &Keymap) -> Result<ChordCodes, StopPathError> {
        let codes = |keysyms: &[u32]| -> Result<BTreeSet<u8>, StopPathError> {
            let codes: BTreeSet<u8> = keysyms.iter().flat_map(|&keysym| keymap.codes(keysym)).collect();
            if codes.is_empty() {
                return Err(StopPathError::Unavailable {
                    reason: UNMAPPED_CHORD.to_owned(),
                });
            }
            Ok(codes)
        };
        Ok(ChordCodes {
            trigger: codes(&self.trigger)?,
            modifiers: self
                .modifiers
                .iter()
                .map(|group| codes(group))
                .collect::<Result<_, _>>()?,
        })
    }
}

/// `stopReason` when the keymap cannot type the chord.
pub const UNMAPPED_CHORD: &str = "stop-chord-unmapped";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChordCodes {
    trigger: BTreeSet<u8>,
    modifiers: Vec<BTreeSet<u8>>,
}

/// Keycodes currently down, fed by raw press/release events.
#[derive(Debug, Default)]
pub struct Pressed {
    down: BTreeSet<u8>,
}

impl Pressed {
    /// Records a raw key press; `true` when it completes `chord`. Extra
    /// held keys still match: a stop is never missed for a stray key.
    pub fn press(&mut self, code: u8, chord: &ChordCodes) -> bool {
        self.down.insert(code);
        chord.trigger.contains(&code)
            && chord
                .modifiers
                .iter()
                .all(|group| group.iter().any(|code| self.down.contains(code)))
    }

    pub fn release(&mut self, code: u8) {
        self.down.remove(&code);
    }
}
