//! Key names and the `+`-chord parser shared by every backend.

use crate::backend::Modifiers;
use crate::error::{CoreResult, DesktopError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyName {
    Ctrl,
    Alt,
    Shift,
    Meta,
    Enter,
    Escape,
    Tab,
    Space,
    Backspace,
    Delete,
    Insert,
    Home,
    End,
    PageUp,
    PageDown,
    Up,
    Down,
    Left,
    Right,
    CapsLock,
    NumLock,
    PrintScreen,
    F1,
    F2,
    F3,
    F4,
    F5,
    F6,
    F7,
    F8,
    F9,
    F10,
    F11,
    F12,
    F13,
    F14,
    F15,
    F16,
    F17,
    F18,
    F19,
    F20,
    F21,
    F22,
    F23,
    F24,
    Char(char),
}

impl KeyName {
    pub const fn is_modifier(self) -> bool {
        matches!(self, Self::Ctrl | Self::Alt | Self::Shift | Self::Meta)
    }
}

pub fn parse_key(value: &str) -> CoreResult<KeyName> {
    let normalized = value.trim().to_ascii_uppercase();
    let key = match normalized.as_str() {
        "CTRL" | "CONTROL" => KeyName::Ctrl,
        "SHIFT" => KeyName::Shift,
        "ALT" | "OPTION" => KeyName::Alt,
        "META" | "CMD" | "COMMAND" | "SUPER" | "WIN" | "WINDOWS" => KeyName::Meta,
        "ENTER" | "RETURN" => KeyName::Enter,
        "ESC" | "ESCAPE" => KeyName::Escape,
        "TAB" => KeyName::Tab,
        "SPACE" => KeyName::Space,
        "BACKSPACE" => KeyName::Backspace,
        "DELETE" | "DEL" => KeyName::Delete,
        "INSERT" => KeyName::Insert,
        "HOME" => KeyName::Home,
        "END" => KeyName::End,
        "PAGEUP" => KeyName::PageUp,
        "PAGEDOWN" => KeyName::PageDown,
        "UP" | "ARROWUP" => KeyName::Up,
        "DOWN" | "ARROWDOWN" => KeyName::Down,
        "LEFT" | "ARROWLEFT" => KeyName::Left,
        "RIGHT" | "ARROWRIGHT" => KeyName::Right,
        "CAPSLOCK" => KeyName::CapsLock,
        "NUMLOCK" => KeyName::NumLock,
        "PRINTSCREEN" | "PRINTSCR" => KeyName::PrintScreen,
        "F1" => KeyName::F1,
        "F2" => KeyName::F2,
        "F3" => KeyName::F3,
        "F4" => KeyName::F4,
        "F5" => KeyName::F5,
        "F6" => KeyName::F6,
        "F7" => KeyName::F7,
        "F8" => KeyName::F8,
        "F9" => KeyName::F9,
        "F10" => KeyName::F10,
        "F11" => KeyName::F11,
        "F12" => KeyName::F12,
        "F13" => KeyName::F13,
        "F14" => KeyName::F14,
        "F15" => KeyName::F15,
        "F16" => KeyName::F16,
        "F17" => KeyName::F17,
        "F18" => KeyName::F18,
        "F19" => KeyName::F19,
        "F20" => KeyName::F20,
        "F21" => KeyName::F21,
        "F22" => KeyName::F22,
        "F23" => KeyName::F23,
        "F24" => KeyName::F24,
        _ => {
            let mut chars = value.trim().chars();
            match (chars.next(), chars.next()) {
                (Some(character), None) => {
                    KeyName::Char(character.to_lowercase().next().unwrap_or(character))
                }
                _ => return Err(DesktopError::invalid_key(format!("unsupported key `{value}`"))),
            }
        }
    };
    Ok(key)
}

pub fn parse_keys(keys: &[String]) -> CoreResult<Vec<KeyName>> {
    let mut parsed = Vec::new();
    for keypress in keys {
        for component in keypress.split('+') {
            if component.trim().is_empty() {
                return Err(DesktopError::invalid_key(format!(
                    "invalid empty component in keypress `{keypress}`"
                )));
            }
            parsed.push(parse_key(component)?);
        }
    }
    Ok(parsed)
}

pub fn parse_modifiers(mods: &[String]) -> CoreResult<Modifiers> {
    let mut result = Modifiers::default();
    for key in parse_keys(mods)? {
        let slot = match key {
            KeyName::Ctrl => &mut result.ctrl,
            KeyName::Alt => &mut result.alt,
            KeyName::Shift => &mut result.shift,
            KeyName::Meta => &mut result.meta,
            _ => {
                return Err(DesktopError::invalid_key(
                    "mouse modifiers may contain modifier keys only",
                ));
            }
        };
        if *slot {
            return Err(DesktopError::invalid_key(
                "mouse modifiers contain a duplicate key",
            ));
        }
        *slot = true;
    }
    Ok(result)
}

#[cfg(test)]
mod tests;
