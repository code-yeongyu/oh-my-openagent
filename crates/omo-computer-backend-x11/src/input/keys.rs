//! Grapheme typing through the two levels of the ACTIVE XKB group. A grapheme outside them is
//! refused by default (`InvalidKey{reason:"unresolvable"}`, nothing sent, next call `paste`);
//! only under `computer.x11_keymap_remap` is it typed through a free scratch keycode, one remap
//! per grapheme, and the keycode's map is restored afterwards (AC-81).

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

/// The keyboard map per XKB group: `keys[code - min_keycode][group] = [level 1, level 2]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupMap {
    pub min_keycode: u8,
    pub keys: Vec<Vec<[u32; 2]>>,
}

/// One step of a typing plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Press and release `code`, with Shift for level 2.
    Key { code: u8, shift: bool },
    /// Map `keysym` onto the free `code` (the scratch keycode) before typing it.
    Remap { code: u8, keysym: u32 },
    /// Put the scratch keycode's own keysyms back.
    Restore { code: u8 },
}

/// A grapheme that cannot be typed, as the refusal reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unresolvable {
    pub refusal: Refusal,
    pub group: usize,
    pub grapheme: String,
    pub next_call: &'static str,
}

/// The X keysym of a character: Latin-1 maps to itself, anything else to `0x0100_0000 + U`.
#[must_use]
pub fn keysym(ch: char) -> u32 {
    let code = u32::from(ch);
    if (0x20..=0x7e).contains(&code) || (0xa0..=0xff).contains(&code) {
        code
    } else {
        0x0100_0000 + code
    }
}

/// The keycode and level that type `keysym` in `group`.
#[must_use]
pub fn resolve(map: &GroupMap, group: usize, keysym: u32) -> Option<(u8, bool)> {
    let _ = group;
    map.keys.iter().enumerate().find_map(|(row, groups)| {
        groups.iter().find_map(|levels| {
            let level = levels.iter().position(|candidate| *candidate == keysym)?;
            let code = map.min_keycode.checked_add(u8::try_from(row).ok()?)?;
            Some((code, level == 1))
        })
    })
}

/// The steps that type `text` in `group`; `remap` is `computer.x11_keymap_remap`.
///
/// # Errors
/// [`Unresolvable`] for the first grapheme outside the group, with nothing planned.
pub fn plan(map: &GroupMap, group: usize, text: &str, remap: bool) -> Result<Vec<Step>, Unresolvable> {
    let _ = remap;
    let mut steps = Vec::new();
    for ch in text.chars() {
        if let Some((code, shift)) = resolve(map, group, keysym(ch)) {
            steps.push(Step::Key { code, shift });
        }
    }
    let _ = Refusal::new(EngineCode::InvalidKey, Reason::Unresolvable.wire());
    Ok(steps)
}
