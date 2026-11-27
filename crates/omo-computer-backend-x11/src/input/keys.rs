//! Grapheme typing through the two levels of the ACTIVE XKB group. A grapheme outside them is
//! refused by default (`InvalidKey{reason:"unresolvable", group, grapheme}`, nothing sent; the
//! error table names `win.paste(text)` as the next call); only under `computer.x11_keymap_remap`
//! is it typed through a scratch keycode that is free in EVERY group and level and bound to no
//! modifier, one remap per grapheme, the keycode's own keysyms restored afterwards (AC-81).

use std::collections::BTreeSet;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use serde_json::json;
use unicode_segmentation::UnicodeSegmentation;

pub const RETURN: u32 = 0xff0d;
const TAB: u32 = 0xff09;
const BACKSPACE: u32 = 0xff08;
const ESCAPE: u32 = 0xff1b;

/// The keyboard map: `keys[code - min_keycode][group] = [level 1, level 2]`, plus the keycodes
/// that carry any keysym in any group or level, or a modifier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupMap {
    pub min_keycode: u8,
    pub keys: Vec<Vec<[u32; 2]>>,
    pub occupied: BTreeSet<u8>,
}

impl GroupMap {
    /// A map whose occupied set is every keycode with a keysym in `keys` or a modifier binding;
    /// `extra` adds keycodes the two-level view cannot show (level 3 and up, other groups).
    #[must_use]
    pub fn new(min_keycode: u8, keys: Vec<Vec<[u32; 2]>>, extra: &BTreeSet<u8>) -> Self {
        let mut occupied = extra.clone();
        for (row, groups) in keys.iter().enumerate() {
            let used = groups.iter().flatten().any(|keysym| *keysym != 0);
            if let Some(code) = code_of(min_keycode, row).filter(|_| used) {
                occupied.insert(code);
            }
        }
        Self {
            min_keycode,
            keys,
            occupied,
        }
    }

    /// The keycode and level that type `keysym` in `group`.
    #[must_use]
    pub fn resolve(&self, group: usize, keysym: u32) -> Option<(u8, bool)> {
        self.keys.iter().enumerate().find_map(|(row, groups)| {
            let level = groups
                .get(group)?
                .iter()
                .position(|candidate| *candidate == keysym)?;
            Some((code_of(self.min_keycode, row)?, level == 1))
        })
    }

    /// The level-1 keysym `code` types in `group`.
    #[must_use]
    pub fn keysym_at(&self, group: usize, code: u8) -> Option<u32> {
        let row = usize::from(code.checked_sub(self.min_keycode)?);
        self.keys
            .get(row)?
            .get(group)
            .map(|levels| levels[0])
            .filter(|keysym| *keysym != 0)
    }

    /// A keycode free in every group and level and bound to no modifier: the scratch keycode.
    fn free_keycode(&self) -> Option<u8> {
        (0..self.keys.len())
            .filter_map(|row| code_of(self.min_keycode, row))
            .find(|code| !self.occupied.contains(code))
    }
}

fn code_of(min_keycode: u8, row: usize) -> Option<u8> {
    min_keycode.checked_add(u8::try_from(row).ok()?)
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

/// The X keysym of one grapheme: the C0 controls with keys of their own, Latin-1 as itself,
/// any other single scalar as `0x0100_0000 + U`; `None` for a grapheme of several scalars
/// (a combining sequence, a ZWJ emoji) or a control no key types.
#[must_use]
pub fn keysym(grapheme: &str) -> Option<u32> {
    match grapheme {
        "\n" | "\r" | "\r\n" => return Some(RETURN),
        "\t" => return Some(TAB),
        "\u{8}" => return Some(BACKSPACE),
        "\u{1b}" => return Some(ESCAPE),
        _ => {}
    }
    let mut scalars = grapheme.chars();
    let (Some(ch), None) = (scalars.next(), scalars.next()) else {
        return None;
    };
    let code = u32::from(ch);
    match code {
        0x20..=0x7e | 0xa0..=0xff => Some(code),
        0..=0x1f | 0x7f..=0x9f => None,
        _ => Some(0x0100_0000 + code),
    }
}

/// The graphemes of `text`, as typing sees them.
pub fn graphemes(text: &str) -> impl Iterator<Item = &str> {
    text.graphemes(true)
}

/// The refusal of `grapheme`: `InvalidKey{unresolvable}` with the group and the grapheme.
#[must_use]
pub fn unresolvable(group: usize, grapheme: &str) -> Refusal {
    Refusal::new(EngineCode::InvalidKey, Reason::Unresolvable)
        .with_data(json!({ "group": group, "grapheme": grapheme }))
}

/// The steps that type `text` in `group`; `remap` is `computer.x11_keymap_remap`.
///
/// # Errors
/// [`unresolvable`] for the first grapheme outside the group (or with no free keycode under
/// the remap), with nothing planned.
pub fn plan(map: &GroupMap, group: usize, text: &str, remap: bool) -> Result<Vec<Step>, Refusal> {
    let scratch = if remap { map.free_keycode() } else { None };
    let mut steps = Vec::new();
    for grapheme in graphemes(text) {
        let keysym = keysym(grapheme).ok_or_else(|| unresolvable(group, grapheme))?;
        if let Some((code, shift)) = map.resolve(group, keysym) {
            steps.push(Step::Key { code, shift });
        } else if let Some(code) = scratch {
            steps.extend([
                Step::Remap { code, keysym },
                Step::Key { code, shift: false },
                Step::Restore { code },
            ]);
        } else {
            return Err(unresolvable(group, grapheme));
        }
    }
    Ok(steps)
}

/// The keysym of one key name of the core grammar (`omo_computer_core::keys::key_name`).
#[must_use]
pub fn named(name: &str) -> Option<u32> {
    let keysym = match name {
        "shift" => 0xffe1,
        "ctrl" => 0xffe3,
        "alt" => 0xffe9,
        "cmd" => 0xffeb,
        "return" => RETURN,
        "tab" => TAB,
        "escape" => ESCAPE,
        "space" => 0x20,
        "backspace" => BACKSPACE,
        "delete" => 0xffff,
        "home" => 0xff50,
        "left" => 0xff51,
        "up" => 0xff52,
        "right" => 0xff53,
        "down" => 0xff54,
        "pageup" => 0xff55,
        "pagedown" => 0xff56,
        "end" => 0xff57,
        _ => {
            let function = name.strip_prefix('f').and_then(|n| n.parse::<u32>().ok());
            return match function {
                Some(n @ 1..=24) => Some(0xffbe + n - 1),
                _ if name.chars().count() == 1 => keysym(name),
                _ => None,
            };
        }
    };
    Some(keysym)
}

/// The key name a keysym reads as, for `user_held_keys`.
#[must_use]
pub fn name_of(keysym: u32) -> Option<String> {
    const NAMES: [&str; 18] = [
        "shift",
        "ctrl",
        "alt",
        "cmd",
        "return",
        "tab",
        "escape",
        "space",
        "backspace",
        "delete",
        "home",
        "left",
        "up",
        "right",
        "down",
        "pageup",
        "pagedown",
        "end",
    ];
    if let Some(name) = NAMES.iter().find(|name| named(name) == Some(keysym)) {
        return Some((*name).to_owned());
    }
    match keysym {
        0xffe2 => Some("shift".to_owned()),
        0xffe4 => Some("ctrl".to_owned()),
        0xffea | 0xffe7 | 0xffe8 => Some("alt".to_owned()),
        0xffec => Some("cmd".to_owned()),
        0xffbe..=0xffd5 => Some(format!("f{}", keysym - 0xffbe + 1)),
        0x21..=0x7e | 0xa0..=0xff => char::from_u32(keysym).map(|ch| ch.to_lowercase().collect()),
        _ => keysym
            .checked_sub(0x0100_0000)
            .and_then(char::from_u32)
            .map(String::from),
    }
}
