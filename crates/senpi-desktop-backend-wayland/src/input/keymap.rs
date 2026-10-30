//! Characters and key names to evdev keycodes: the announced XKB keymap
//! first (group-aware), the static US table only where it is provably right.

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;

use super::xkb::{KeyStroke, KeyboardLayout};

/// evdev `KEY_LEFTSHIFT`.
pub const SHIFT: u32 = 42;
/// evdev `KEY_LEFTCTRL`, `KEY_LEFTALT`, `KEY_LEFTMETA`.
pub const CTRL: u32 = 29;
pub const ALT: u32 = 56;
pub const META: u32 = 125;

fn ascii_stroke((keycode, shift): (u32, bool)) -> KeyStroke {
    KeyStroke {
        keycode,
        modifiers: if shift { vec![SHIFT] } else { Vec::new() },
    }
}

/// Resolves only through the active XKB group. Falling back to a key from a
/// different group would emit the wrong glyph because libei cannot request a
/// portable compositor group switch, so printable misses are reported.
pub fn char_stroke(layout: Option<&KeyboardLayout>, character: char) -> CoreResult<KeyStroke> {
    let Some(layout) = layout else {
        return evdev_char(character).map(ascii_stroke).ok_or_else(|| {
            DesktopError::input_failed(format!(
                "libei cannot type character {character:?}: no usable XKB keymap was announced"
            ))
        });
    };
    if character.is_ascii() && layout.can_use_us_ascii_fast_path() {
        if let Some(ascii) = evdev_char(character) {
            return Ok(ascii_stroke(ascii));
        }
    }
    if let Some(stroke) = layout.resolve_char(character) {
        return Ok(stroke);
    }
    if character.is_control() {
        if let Some(ascii) = evdev_char(character) {
            return Ok(ascii_stroke(ascii));
        }
    }
    Err(DesktopError::input_failed(format!(
        "libei cannot type character {character:?} in active XKB group {}",
        layout.active_group()
    )))
}

/// The stroke for one chord key: characters through the keymap, named keys
/// through the fixed evdev table.
pub fn key_stroke(layout: Option<&KeyboardLayout>, key: KeyName) -> CoreResult<KeyStroke> {
    match key {
        KeyName::Char(character) => char_stroke(layout, character),
        named => Ok(KeyStroke {
            keycode: evdev_keycode(named)?,
            modifiers: Vec::new(),
        }),
    }
}

fn evdev_keycode(key: KeyName) -> CoreResult<u32> {
    let code = match key {
        KeyName::Ctrl => CTRL,
        KeyName::Alt => ALT,
        KeyName::Shift => SHIFT,
        KeyName::Meta => META,
        KeyName::Enter => 28,
        KeyName::Escape => 1,
        KeyName::Tab => 15,
        KeyName::Space => 57,
        KeyName::Backspace => 14,
        KeyName::Delete => 111,
        KeyName::Insert => 110,
        KeyName::Home => 102,
        KeyName::End => 107,
        KeyName::PageUp => 104,
        KeyName::PageDown => 109,
        KeyName::Up => 103,
        KeyName::Down => 108,
        KeyName::Left => 105,
        KeyName::Right => 106,
        KeyName::CapsLock => 58,
        KeyName::NumLock => 69,
        KeyName::PrintScreen => 99,
        KeyName::F1 => 59,
        KeyName::F2 => 60,
        KeyName::F3 => 61,
        KeyName::F4 => 62,
        KeyName::F5 => 63,
        KeyName::F6 => 64,
        KeyName::F7 => 65,
        KeyName::F8 => 66,
        KeyName::F9 => 67,
        KeyName::F10 => 68,
        KeyName::F11 => 87,
        KeyName::F12 => 88,
        KeyName::F13 => 183,
        KeyName::F14 => 184,
        KeyName::F15 => 185,
        KeyName::F16 => 186,
        KeyName::F17 => 187,
        KeyName::F18 => 188,
        KeyName::F19 => 189,
        KeyName::F20 => 190,
        KeyName::F21 => 191,
        KeyName::F22 => 192,
        KeyName::F23 => 193,
        KeyName::F24 => 194,
        KeyName::Char(character) => evdev_char(character)
            .map(|(code, _)| code)
            .ok_or_else(|| DesktopError::input_failed(format!("no evdev keycode for {character:?}")))?,
    };
    Ok(code)
}

/// US-layout evdev keycode and whether Shift is needed.
fn evdev_char(character: char) -> Option<(u32, bool)> {
    const LETTERS: [u32; 26] = [
        30, 48, 46, 32, 18, 33, 34, 35, 23, 36, 37, 38, 50, 49, 24, 25, 16, 19, 31, 20, 22, 47, 17, 45, 21,
        44,
    ];
    let lower = character.to_ascii_lowercase();
    let code = match lower {
        'a'..='z' => *LETTERS.get(usize::from(u8::try_from(lower).ok()? - b'a'))?,
        '1'..='9' => 2 + u32::from(lower) - u32::from('1'),
        '0' => 11,
        ' ' => 57,
        '\n' | '\r' => 28,
        '\t' => 15,
        '-' | '_' => 12,
        '=' | '+' => 13,
        '[' | '{' => 26,
        ']' | '}' => 27,
        '\\' | '|' => 43,
        ';' | ':' => 39,
        '\'' | '"' => 40,
        '`' | '~' => 41,
        ',' | '<' => 51,
        '.' | '>' => 52,
        '/' | '?' => 53,
        '!' => 2,
        '@' => 3,
        '#' => 4,
        '$' => 5,
        '%' => 6,
        '^' => 7,
        '&' => 8,
        '*' => 9,
        '(' => 10,
        ')' => 11,
        _ => return None,
    };
    let shift = character.is_ascii_uppercase() || "_+{}|:\"~<>?!@#$%^&*()".contains(character);
    Some((code, shift))
}

#[cfg(test)]
mod tests {
    use super::*;

    const US_FR: &str = include_str!("../../testdata/us-fr.xkb");

    #[test]
    fn without_a_keymap_ascii_uses_the_us_table_and_other_chars_are_refused() {
        assert_eq!(char_stroke(None, 'A').ok(), Some(ascii_stroke((30, true))));
        let refused = char_stroke(None, 'é').err().map(|error| error.code);
        assert_eq!(refused, Some(senpi_desktop_core::error::ErrorCode::InputFailed));
    }

    #[test]
    fn a_char_missing_from_the_active_group_is_refused_not_borrowed() {
        let layout = KeyboardLayout::compile(US_FR).expect("US/French fixture must compile");
        let error = char_stroke(Some(&layout), 'é').err();
        assert_eq!(
            error.map(|error| error.message),
            Some("libei cannot type character 'é' in active XKB group 0".to_owned())
        );
    }

    #[test]
    fn named_keys_map_to_fixed_evdev_codes() {
        let stroke = key_stroke(None, KeyName::Escape).ok();
        assert_eq!(stroke.map(|stroke| stroke.keycode), Some(1));
    }
}
