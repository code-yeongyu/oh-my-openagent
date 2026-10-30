//! `xkb_keycodes` and `xkb_symbols` sections of a textual keymap: key names
//! to keycodes, per-group key types and symbol levels, keysym names to chars.

use std::collections::{HashMap, HashSet};

use xkeysym::Keysym;

pub struct ParsedKey {
    pub keycode: u32,
    pub types: HashMap<usize, String>,
    pub symbols: HashMap<usize, Vec<String>>,
}

/// The body of the first `name { ... }` section.
pub fn extract_section<'a>(source: &'a str, name: &str) -> Option<&'a str> {
    let start = source.find(name)?;
    let open = start + source[start..].find('{')?;
    let close = matching_brace(source, open)?;
    Some(&source[open + 1..close])
}

pub fn matching_brace(source: &str, open: usize) -> Option<usize> {
    let mut depth = 0_u32;
    for (offset, byte) in source.as_bytes()[open..].iter().enumerate() {
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(open + offset);
                }
            }
            _ => {}
        }
    }
    None
}

pub fn parse_keycodes(section: &str) -> HashMap<String, u32> {
    section
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let name = line.strip_prefix('<')?.split_once('>')?.0;
            let value = line.split_once('=')?.1.trim().trim_end_matches(';').trim();
            Some((name.to_owned(), value.parse().ok()?))
        })
        .collect()
}

pub fn parse_keys(section: &str, keycodes: &HashMap<String, u32>) -> Vec<ParsedKey> {
    let mut keys = Vec::new();
    let mut offset = 0;
    while let Some(relative) = section[offset..].find("key <") {
        let start = offset + relative;
        let Some(name_end) = section[start + 5..].find('>') else {
            break;
        };
        let name = &section[start + 5..start + 5 + name_end];
        let Some(open_relative) = section[start..].find('{') else {
            break;
        };
        let open = start + open_relative;
        let Some(close) = matching_brace(section, open) else {
            break;
        };
        if let Some(&keycode) = keycodes.get(name) {
            let body = &section[open + 1..close];
            keys.push(ParsedKey {
                keycode,
                types: parse_group_types(body),
                symbols: parse_group_symbols(body),
            });
        }
        offset = close + 1;
    }
    keys
}

/// `GroupN` (1-based) as a 0-based group index.
fn group_index(digits: &str) -> Option<usize> {
    digits.parse::<usize>().ok()?.checked_sub(1)
}

/// The first `"..."` string in `text`.
fn quoted(text: &str) -> Option<&str> {
    let first = text.find('"')?;
    let second = text[first + 1..].find('"')?;
    Some(&text[first + 1..first + 1 + second])
}

fn parse_group_types(body: &str) -> HashMap<usize, String> {
    let mut types = HashMap::new();
    let mut offset = 0;
    while let Some(relative) = body[offset..].find("type[Group") {
        let start = offset + relative + "type[Group".len();
        let Some(end) = body[start..].find(']') else {
            break;
        };
        let Some(group) = group_index(&body[start..start + end]) else {
            break;
        };
        if let Some(name) = quoted(&body[start + end + 1..]) {
            types.insert(group, name.to_owned());
        }
        offset = start + end + 1;
    }
    if types.is_empty() {
        if let Some(name) = body.find("type=").and_then(|start| quoted(&body[start..])) {
            types.insert(0, name.to_owned());
        }
    }
    types
}

fn parse_group_symbols(body: &str) -> HashMap<usize, Vec<String>> {
    let mut symbols = HashMap::new();
    let mut offset = 0;
    while let Some(relative) = body[offset..].find("symbols[Group") {
        let start = offset + relative + "symbols[Group".len();
        let Some(group_end) = body[start..].find(']') else {
            break;
        };
        let Some(group) = group_index(&body[start..start + group_end]) else {
            break;
        };
        let remainder_start = start + group_end + 1;
        let Some(open_relative) = body[remainder_start..].find('[') else {
            break;
        };
        let open = remainder_start + open_relative;
        let Some(close_relative) = body[open + 1..].find(']') else {
            break;
        };
        let close = open + 1 + close_relative;
        symbols.insert(group, split_symbols(&body[open + 1..close]));
        offset = close + 1;
    }
    if symbols.is_empty() {
        if let Some(open) = body.find('[') {
            if let Some(close_relative) = body[open + 1..].find(']') {
                symbols.insert(0, split_symbols(&body[open + 1..open + 1 + close_relative]));
            }
        }
    }
    symbols
}

fn split_symbols(list: &str) -> Vec<String> {
    list.split(',')
        .map(str::trim)
        .filter(|symbol| !symbol.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The key type XKB infers for a key that names none.
pub fn infer_type(symbols: &[String], keysyms: &HashMap<String, char>) -> &'static str {
    let alphabetic = match symbols {
        [lower, upper, ..] => keysyms
            .get(lower)
            .zip(keysyms.get(upper))
            .is_some_and(|(&lower, &upper)| {
                lower.is_lowercase() && upper == lower.to_uppercase().next().unwrap_or(lower)
            }),
        _ => false,
    };
    match (symbols.len(), alphabetic) {
        (0 | 1, _) => "ONE_LEVEL",
        (2, true) => "ALPHABETIC",
        (2, false) => "TWO_LEVEL",
        (_, true) => "FOUR_LEVEL_ALPHABETIC",
        (_, false) => "FOUR_LEVEL",
    }
}

/// Keysym names (`eacute`, `U00E9`, `0x1000e9`) to the character they type.
pub fn resolve_keysyms(names: &HashSet<String>) -> HashMap<String, char> {
    let mut resolved = HashMap::new();
    for name in names {
        let direct = name
            .strip_prefix('U')
            .and_then(|hex| u32::from_str_radix(hex, 16).ok())
            .and_then(char::from_u32)
            .or_else(|| {
                name.strip_prefix("0x")
                    .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                    .and_then(|raw| Keysym::new(raw).key_char())
            });
        if let Some(character) = direct {
            resolved.insert(name.clone(), character);
        }
    }
    for raw in 0x20..=0xffff {
        let keysym = Keysym::new(raw);
        let Some(name) = keysym.name().and_then(|debug| debug.strip_prefix("XK_")) else {
            continue;
        };
        if names.contains(name) {
            if let Some(character) = keysym.key_char() {
                resolved.insert(name.to_owned(), character);
            }
        }
    }
    resolved
}
