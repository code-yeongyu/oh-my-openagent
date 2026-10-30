//! The `xkb_types` section: virtual modifiers, key types (modifier mask to
//! shift level), and the evdev modifier keys a stroke may hold.

use std::collections::HashMap;
use std::sync::Arc;

use super::symbols::matching_brace;

/// A modifier this crate can hold: the state bits it sets and its evdev key.
#[derive(Clone, Copy)]
pub struct ModifierReq {
    pub active_mask: u32,
    pub keycode: u32,
}

#[derive(Default)]
pub struct TypeDef {
    mask: u32,
    maps: HashMap<u32, usize>,
}

impl TypeDef {
    /// The 0-based shift level `state` selects.
    pub fn level(&self, state: u32) -> usize {
        self.maps.get(&(state & self.mask)).copied().unwrap_or(0)
    }
}

pub fn parse_virtual_modifiers(section: &str) -> HashMap<String, u32> {
    let Some(start) = section.find("virtual_modifiers") else {
        return HashMap::new();
    };
    let list = &section[start + "virtual_modifiers".len()..];
    let Some(end) = list.find(';') else {
        return HashMap::new();
    };
    (8_u32..)
        .zip(list[..end].split(',').map(str::trim))
        .filter_map(|(shift, name)| Some((name.to_owned(), 1_u32.checked_shl(shift)?)))
        .collect()
}

pub fn parse_types(section: &str, virtuals: &HashMap<String, u32>) -> HashMap<String, Arc<TypeDef>> {
    let mut types = HashMap::new();
    let mut offset = 0;
    while let Some(relative) = section[offset..].find("type \"") {
        let start = offset + relative + "type \"".len();
        let Some(name_end) = section[start..].find('"') else {
            break;
        };
        let name = section[start..start + name_end].to_owned();
        let Some(open_relative) = section[start + name_end..].find('{') else {
            break;
        };
        let open = start + name_end + open_relative;
        let Some(close) = matching_brace(section, open) else {
            break;
        };
        types.insert(
            name,
            Arc::new(parse_type_body(&section[open + 1..close], virtuals)),
        );
        offset = close + 1;
    }
    types
}

fn parse_type_body(body: &str, virtuals: &HashMap<String, u32>) -> TypeDef {
    let mut definition = TypeDef::default();
    for line in body.lines().map(str::trim) {
        if let Some(modifiers) = line.strip_prefix("modifiers=") {
            definition.mask =
                parse_modifier_mask(modifiers.trim().trim_end_matches(';'), virtuals).unwrap_or(0);
            continue;
        }
        let Some((combination, level)) = line.strip_prefix("map[").and_then(|map| map.split_once("]="))
        else {
            continue;
        };
        let Some(mask) = parse_modifier_mask(combination, virtuals) else {
            continue;
        };
        let Ok(level) = level.trim().trim_end_matches(';').parse::<usize>() else {
            continue;
        };
        definition.maps.insert(mask, level.saturating_sub(1));
    }
    definition
}

fn parse_modifier_mask(value: &str, virtuals: &HashMap<String, u32>) -> Option<u32> {
    if value == "none" {
        return Some(0);
    }
    value
        .split('+')
        .map(str::trim)
        .try_fold(0, |mask, name| Some(mask | modifier_bit(name, virtuals)?))
}

fn modifier_bit(name: &str, virtuals: &HashMap<String, u32>) -> Option<u32> {
    let bit = match name {
        "Shift" => 1 << 0,
        "Lock" => 1 << 1,
        "Control" => 1 << 2,
        "Mod1" => 1 << 3,
        "Mod2" => 1 << 4,
        "Mod3" => 1 << 5,
        "Mod4" => 1 << 6,
        "Mod5" => 1 << 7,
        virtual_name => *virtuals.get(virtual_name)?,
    };
    Some(bit)
}

/// Shift, Control, Alt, Meta and AltGr (`LevelThree`) with their evdev keys.
pub fn holdable_modifiers(virtuals: &HashMap<String, u32>) -> Vec<ModifierReq> {
    [
        ("Shift", 1 << 0, 42),
        ("Control", 1 << 2, 29),
        ("Alt", 1 << 3, 56),
        ("Meta", 1 << 6, 125),
        ("LevelThree", 1 << 7, 100),
    ]
    .into_iter()
    .map(|(virtual_name, real_mask, keycode)| ModifierReq {
        active_mask: virtuals
            .get(virtual_name)
            .copied()
            .map_or(real_mask, |bit| real_mask | bit),
        keycode,
    })
    .collect()
}

/// Adds the virtual modifier bits the active real modifiers imply.
pub fn expand_virtual_modifiers(mut state: u32, virtuals: &HashMap<String, u32>) -> u32 {
    for (real_bit, names) in [
        (1 << 3, &["Alt"][..]),
        (1 << 4, &["NumLock"][..]),
        (1 << 5, &["LevelFive"][..]),
        (1 << 6, &["Meta", "Super", "Hyper"][..]),
        (1 << 7, &["LevelThree"][..]),
    ] {
        if state & real_bit != 0 {
            for name in names {
                state |= virtuals.get(*name).copied().unwrap_or(0);
            }
        }
    }
    state
}
