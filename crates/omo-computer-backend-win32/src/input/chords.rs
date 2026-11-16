//! The posted-route chord rules (d-windows.md '## Input', Chords, holds, release). A posted message
//! is not key state: the target reads the user's REAL modifiers, and Alt is the only modifier a
//! message carries (`WM_SYSKEY*`, lParam bit 29). So on the posted route a Shift, Ctrl or Win chord
//! on a non-character key, and any Ctrl or Win chord, is refused before any post; a shifted letter
//! is the capital letter itself as `WM_CHAR`, never a posted Shift. Alt on a character posts the
//! character's own virtual key only for A-Z, 0-9 and space (where the code IS the key): any other
//! character, Alt+Shift, and Shift on a non-letter are refused - no virtual key is guessed and no
//! modifier is dropped (review M1 and L1 of #13349).

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use super::{posted_key, Posted, WM_CHAR};

/// The modifiers of a chord.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Mods {
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub win: bool,
}

impl Mods {
    pub const NONE: Self = Self {
        shift: false,
        ctrl: false,
        alt: false,
        win: false,
    };
}

/// The key of a chord: a character, or a named (non-character) key by its virtual key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Key {
    Char(char),
    Named(u16),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Chord {
    pub mods: Mods,
    pub key: Key,
}

/// The refusal of a chord the posted route cannot carry; nothing is posted.
pub const POSTED_MODIFIER_CHORD: Refusal = Refusal::new(
    EngineCode::BackgroundUnavailable,
    Reason::PostedModifierChord.wire(),
);

/// The messages that post `chord` to a background window.
///
/// # Errors
/// [`POSTED_MODIFIER_CHORD`] for a Ctrl or Win chord, a Shift chord on a named key or a non-letter,
/// Alt+Shift on a character, or Alt on a character other than A-Z, 0-9 and space.
pub fn posted_press(chord: &Chord) -> Result<Vec<Posted>, Refusal> {
    let Mods {
        shift,
        ctrl,
        alt,
        win,
    } = chord.mods;
    if ctrl || win || (shift && matches!(chord.key, Key::Named(_))) {
        return Err(POSTED_MODIFIER_CHORD);
    }
    match chord.key {
        Key::Named(vk) => Ok(vec![posted_key(vk, true, alt), posted_key(vk, false, alt)]),
        Key::Char(c) if alt => {
            if shift || !(c.is_ascii_alphanumeric() || c == ' ') {
                return Err(POSTED_MODIFIER_CHORD);
            }
            let vk = u16::from(u8::try_from(c.to_ascii_uppercase()).unwrap_or(0));
            Ok(vec![
                posted_key(vk, true, true),
                posted_key(vk, false, true),
            ])
        }
        Key::Char(c) => {
            let c = if shift {
                // Only a letter has a shifted form we know without the layout.
                if !(c.is_lowercase() || c.is_uppercase()) || c.to_uppercase().count() != 1 {
                    return Err(POSTED_MODIFIER_CHORD);
                }
                c.to_uppercase().next().unwrap_or(c)
            } else {
                c
            };
            let mut units = [0u16; 2];
            Ok(c.encode_utf16(&mut units)
                .iter()
                .map(|unit| Posted {
                    msg: WM_CHAR,
                    wparam: usize::from(*unit),
                    lparam: 1,
                })
                .collect())
        }
    }
}
