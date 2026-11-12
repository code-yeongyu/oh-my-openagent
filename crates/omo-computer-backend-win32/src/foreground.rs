//! The foreground lease's pure policy (d-windows.md '## Input', foreground lease): the restore
//! decision on the OS clock, the user-held modifier rule before any `SendInput` key, chord, text or
//! pointer batch, and the one `SendInput` batch that delivers a chord the posted route refused.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use crate::input::chords::{Chord, Key};
use crate::input::{KeyUnit, VK_CONTROL, VK_LWIN, VK_MENU, VK_SHIFT};
use crate::stop_path::PhysicalChord;

/// What the lease does with focus when it ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Restore {
    /// Restore the window that was foreground before the lease.
    Previous(isize),
    /// Leave the user's choice alone: `focusRestoration:"user_moved_on"`.
    UserMovedOn,
}

/// Restores only when the foreground is still the target (or a window it owns) and no physical
/// input arrived after activation; a third window or a later physical input leaves it alone.
#[must_use]
pub fn restore(
    target: isize,
    previous: isize,
    foreground: isize,
    owned_by_target: &dyn Fn(isize) -> bool,
    last_physical: Option<u64>,
    activated_at: u64,
) -> Restore {
    let ours = foreground == target || owned_by_target(foreground);
    let user_acted = last_physical.is_some_and(|at| at > activated_at);
    if ours && !user_acted {
        Restore::Previous(previous)
    } else {
        Restore::UserMovedOn
    }
}

/// The refusal of a leased send while the user holds a modifier, and which modifiers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserModifierHeld {
    pub refusal: Refusal,
    pub keys: Vec<&'static str>,
}

const MODIFIERS: [(u16, &str); 4] = [
    (VK_SHIFT, "shift"),
    (VK_CONTROL, "ctrl"),
    (VK_MENU, "alt"),
    (VK_LWIN, "win"),
];

/// Admits a leased `SendInput` batch: a Shift, Ctrl, Alt or Win key the user holds physically, and
/// the engine does not hold on its ledger, refuses with nothing sent (`retry:"after_user"`).
///
/// # Errors
/// [`UserModifierHeld`] naming the held modifiers.
pub fn admit_leased(physical: &PhysicalChord, engine_held: &[u16]) -> Result<(), UserModifierHeld> {
    let held = physical.held();
    let keys: Vec<&'static str> = MODIFIERS
        .iter()
        .filter(|(vk, _)| held.contains(vk) && !engine_held.contains(vk))
        .map(|(_, name)| *name)
        .collect();
    if keys.is_empty() {
        Ok(())
    } else {
        Err(UserModifierHeld {
            refusal: Refusal::new(
                EngineCode::BackgroundUnavailable,
                Reason::UserModifierHeld.wire(),
            ),
            keys,
        })
    }
}

/// One `SendInput` batch for `chord` under the lease: modifiers down, the key, modifiers up in reverse.
#[must_use]
pub fn foreground_chord(chord: &Chord) -> Vec<KeyUnit> {
    let mods: Vec<u16> = [
        (chord.mods.shift, VK_SHIFT),
        (chord.mods.ctrl, VK_CONTROL),
        (chord.mods.alt, VK_MENU),
        (chord.mods.win, VK_LWIN),
    ]
    .iter()
    .filter(|(on, _)| *on)
    .map(|(_, vk)| *vk)
    .collect();
    let (down, up) = match chord.key {
        Key::Named(vk) => (
            KeyUnit::scan_coded(vk, true),
            KeyUnit::scan_coded(vk, false),
        ),
        Key::Char(c) => {
            let unit = u16::try_from(u32::from(c)).unwrap_or(0);
            (KeyUnit::unicode(unit, true), KeyUnit::unicode(unit, false))
        }
    };
    let mut batch: Vec<KeyUnit> = mods
        .iter()
        .map(|vk| KeyUnit::virtual_key(*vk, true))
        .collect();
    batch.push(down);
    batch.push(up);
    batch.extend(mods.iter().rev().map(|vk| KeyUnit::virtual_key(*vk, false)));
    batch
}
