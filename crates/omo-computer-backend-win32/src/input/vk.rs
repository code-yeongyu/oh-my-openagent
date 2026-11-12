//! Row 23's key grammar (`omo_computer_core::keys`) on Windows: each canonical name to its virtual
//! key, and a grammar chord to the backend's [`Chord`]. A single character is kept as a character
//! (the layout-independent routes type it), so no virtual key is ever guessed from the layout.

use omo_computer_core::keys::{chord_keys, BadKey};

use super::chords::{Chord, Key, Mods};
use super::{VK_CONTROL, VK_LWIN, VK_MENU, VK_RETURN, VK_SHIFT, VK_TAB};

/// The virtual key of a canonical non-character name, `None` for a single character.
#[must_use]
pub fn vk_of(name: &str) -> Option<u16> {
    let vk = match name {
        "shift" => VK_SHIFT,
        "ctrl" => VK_CONTROL,
        "alt" => VK_MENU,
        "cmd" => VK_LWIN,
        "return" => VK_RETURN,
        "tab" => VK_TAB,
        "escape" => 0x1B,
        "space" => 0x20,
        "backspace" => 0x08,
        "delete" => 0x2E,
        "up" => 0x26,
        "down" => 0x28,
        "left" => 0x25,
        "right" => 0x27,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        other => {
            let n: u16 = other.strip_prefix('f')?.parse().ok()?;
            return (1..=24).contains(&n).then_some(0x70 + n - 1);
        }
    };
    Some(vk)
}

/// A grammar chord as a Windows [`Chord`]: modifiers plus exactly one non-modifier key.
///
/// # Errors
/// The grammar's [`BadKey`] for an unknown token, or for a chord without exactly one non-modifier key.
pub fn chord_of(text: &str) -> Result<Chord, BadKey> {
    let names = chord_keys(text)?;
    let mut mods = Mods::NONE;
    let mut key = None;
    for name in &names {
        match name.as_str() {
            "shift" => mods.shift = true,
            "ctrl" => mods.ctrl = true,
            "alt" => mods.alt = true,
            "cmd" => mods.win = true,
            other if key.is_none() => {
                let mut chars = other.chars();
                key = Some(match (chars.next(), chars.next()) {
                    (Some(c), None) => Key::Char(c),
                    _ => Key::Named(vk_of(other).ok_or_else(|| BadKey {
                        token: other.to_owned(),
                    })?),
                });
            }
            other => {
                return Err(BadKey {
                    token: other.to_owned(),
                })
            }
        }
    }
    key.map(|key| Chord { mods, key }).ok_or_else(|| BadKey {
        token: text.to_owned(),
    })
}
