//! Group-aware character resolution for compositor-provided XKB keymaps.
//!
//! libei sends the already-compiled textual keymap, so this module reads its
//! keycodes, types, and per-group symbol levels directly in pure Rust (no
//! libxkbcommon). Resolution never borrows a key from another group: libei
//! has no portable request for changing the compositor's active group, and
//! doing so implicitly would type the wrong glyph when the switch failed.
//! Ported from oh-my-pi `linux/wayland/xkb.rs` (commits 95776f011f, 7fcbfb6a9c).

mod symbols;
mod types;

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::os::fd::OwnedFd;
use std::sync::Arc;

use symbols::{extract_section, infer_type, parse_keycodes, parse_keys, resolve_keysyms};
use types::{expand_virtual_modifiers, holdable_modifiers, parse_types, parse_virtual_modifiers};
use types::{ModifierReq, TypeDef};

/// One evdev key press plus the evdev modifier keys held around it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyStroke {
    pub keycode: u32,
    pub modifiers: Vec<u32>,
}

#[derive(Clone, Copy, Default)]
struct ModifierState {
    depressed: u32,
    latched: u32,
    locked: u32,
    group: u32,
}

#[derive(Clone)]
struct Candidate {
    keycode: u32,
    level: usize,
    key_type: Arc<TypeDef>,
}

pub struct KeyboardLayout {
    groups: Vec<HashMap<char, Vec<Candidate>>>,
    us_groups: Vec<bool>,
    virtuals: HashMap<String, u32>,
    modifiers: ModifierState,
}

impl KeyboardLayout {
    /// Reads the keymap libei announced; `None` when it is unreadable or not
    /// a textual XKB keymap.
    pub fn from_fd(fd: OwnedFd, size: usize) -> Option<Self> {
        let mut bytes = Vec::with_capacity(size);
        File::from(fd)
            .take(u64::try_from(size).ok()?)
            .read_to_end(&mut bytes)
            .ok()?;
        let text = bytes.split(|&byte| byte == 0).next().unwrap_or(&bytes);
        Self::compile(std::str::from_utf8(text).ok()?)
    }

    pub(crate) fn compile(source: &str) -> Option<Self> {
        let keycodes = parse_keycodes(extract_section(source, "xkb_keycodes")?);
        let keys = parse_keys(extract_section(source, "xkb_symbols")?, &keycodes);
        let group_count = keys
            .iter()
            .flat_map(|key| key.symbols.keys())
            .max()
            .copied()
            .map_or(0, |group| group + 1);
        if group_count == 0 {
            return None;
        }
        let types_section = extract_section(source, "xkb_types")?;
        let virtuals = parse_virtual_modifiers(types_section);
        let types = parse_types(types_section, &virtuals);
        let names = keys
            .iter()
            .flat_map(|key| key.symbols.values().flatten().cloned())
            .collect::<HashSet<_>>();
        let keysyms = resolve_keysyms(&names);
        let mut groups = (0..group_count).map(|_| HashMap::new()).collect::<Vec<_>>();
        for key in keys {
            let Some(group_one) = key.symbols.get(&0) else {
                continue;
            };
            for (group, table) in groups.iter_mut().enumerate() {
                let symbols = key.symbols.get(&group).unwrap_or(group_one);
                let type_name = key
                    .types
                    .get(&group)
                    .or_else(|| key.types.get(&0))
                    .map_or_else(|| infer_type(symbols, &keysyms), String::as_str);
                let Some(key_type) = types.get(type_name) else {
                    continue;
                };
                for (level, symbol) in symbols.iter().enumerate() {
                    let Some(&character) = keysyms.get(symbol) else {
                        continue;
                    };
                    table.entry(character).or_insert_with(Vec::new).push(Candidate {
                        keycode: key.keycode.saturating_sub(8),
                        level,
                        key_type: Arc::clone(key_type),
                    });
                }
            }
        }
        let us_groups = groups.iter().map(|group| group_is_us(group, &virtuals)).collect();
        Some(Self {
            groups,
            us_groups,
            virtuals,
            modifiers: ModifierState::default(),
        })
    }

    /// Applies a libei `keyboard.modifiers` event.
    pub const fn update_modifiers(&mut self, depressed: u32, latched: u32, locked: u32, group: u32) {
        self.modifiers = ModifierState {
            depressed,
            latched,
            locked,
            group,
        };
    }

    pub const fn active_group(&self) -> u32 {
        self.modifiers.group
    }

    /// The active group is a plain US layout with no modifier active, so the
    /// static evdev ASCII table types the right glyph.
    pub fn can_use_us_ascii_fast_path(&self) -> bool {
        let modifiers = self.modifiers;
        modifiers.depressed == 0
            && modifiers.latched == 0
            && modifiers.locked == 0
            && usize::try_from(modifiers.group)
                .ok()
                .and_then(|group| self.us_groups.get(group))
                .copied()
                .unwrap_or(false)
    }

    /// The stroke with the fewest held modifiers that types `character` in
    /// the active group, or `None` when the active group cannot type it.
    pub fn resolve_char(&self, character: char) -> Option<KeyStroke> {
        let active = expand_virtual_modifiers(
            self.modifiers.depressed | self.modifiers.latched | self.modifiers.locked,
            &self.virtuals,
        );
        let holdable = holdable_modifiers(&self.virtuals);
        self.groups
            .get(usize::try_from(self.modifiers.group).ok()?)?
            .get(&character)?
            .iter()
            .filter_map(|candidate| candidate.stroke(active, &holdable))
            .min_by_key(|stroke| stroke.modifiers.len())
    }
}

impl Candidate {
    fn stroke(&self, active: u32, holdable: &[ModifierReq]) -> Option<KeyStroke> {
        let available = holdable
            .iter()
            .copied()
            .filter(|modifier| active & modifier.active_mask == 0)
            .collect::<Vec<_>>();
        let mut best: Option<Vec<u32>> = None;
        for subset in 0..(1_u32 << available.len()) {
            let mut state = active;
            let mut keycodes = Vec::new();
            for (index, modifier) in available.iter().enumerate() {
                if subset & (1 << index) != 0 {
                    state |= modifier.active_mask;
                    keycodes.push(modifier.keycode);
                }
            }
            if self.key_type.level(state) == self.level
                && best
                    .as_ref()
                    .is_none_or(|existing| keycodes.len() < existing.len())
            {
                best = Some(keycodes);
            }
        }
        best.map(|modifiers| KeyStroke {
            keycode: self.keycode,
            modifiers,
        })
    }
}

fn group_is_us(table: &HashMap<char, Vec<Candidate>>, virtuals: &HashMap<String, u32>) -> bool {
    const ROWS: &[(u32, &str, &str)] = &[
        (2, "1234567890-=", "!@#$%^&*()_+"),
        (16, "qwertyuiop[]", "QWERTYUIOP{}"),
        (30, "asdfghjkl;'`", "ASDFGHJKL:\"~"),
        (43, "\\", "|"),
        (44, "zxcvbnm,./", "ZXCVBNM<>?"),
    ];
    let holdable = holdable_modifiers(virtuals);
    // Whether `character` is typed by `keycode` holding exactly `modifiers`.
    let typed_by = |character: char, keycode: u32, modifiers: &[u32]| {
        table.get(&character).is_some_and(|candidates| {
            candidates.iter().any(|candidate| {
                candidate.keycode == keycode
                    && candidate
                        .stroke(0, &holdable)
                        .is_some_and(|stroke| stroke.modifiers == modifiers)
            })
        })
    };
    ROWS.iter().all(|&(first, base, shifted)| {
        (first..)
            .zip(base.chars().zip(shifted.chars()))
            .all(|(keycode, (base, shifted))| {
                typed_by(base, keycode, &[]) && typed_by(shifted, keycode, &[42])
            })
    })
}

#[cfg(test)]
mod tests;
