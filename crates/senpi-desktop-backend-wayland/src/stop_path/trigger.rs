//! The configured stop chord as the XDG "shortcuts" trigger string the
//! GlobalShortcuts portal takes as `preferred_trigger`: modifiers `CTRL`,
//! `ALT`, `SHIFT`, `LOGO` joined by `+`, then one XKB keysym name.

use senpi_desktop_safety::{Chord, StopPathError};

/// The shortcut id bound in the portal session; `Activated` for any other
/// id is ignored.
pub const STOP_SHORTCUT_ID: &str = "senpi-desktop-stop";

const MODIFIERS: [(&str, &[&str]); 4] = [
    ("CTRL", &["ctrl", "control"]),
    ("ALT", &["alt", "opt", "option"]),
    ("SHIFT", &["shift"]),
    ("LOGO", &["meta", "cmd", "command", "super", "logo", "win"]),
];

fn keysym_name(key: &str) -> Option<String> {
    let named = match key {
        "escape" | "esc" => "Escape",
        "enter" | "return" => "Return",
        "tab" => "Tab",
        "space" => "space",
        "backspace" => "BackSpace",
        "delete" | "del" => "Delete",
        "insert" => "Insert",
        "home" => "Home",
        "end" => "End",
        "pageup" => "Page_Up",
        "pagedown" => "Page_Down",
        "up" => "Up",
        "down" => "Down",
        "left" => "Left",
        "right" => "Right",
        function => {
            let number = function.strip_prefix('f')?.parse::<u8>().ok()?;
            return (1..=24).contains(&number).then(|| format!("F{number}"));
        }
    };
    Some(named.to_owned())
}

fn single_char(key: &str) -> Option<String> {
    let mut chars = key.chars();
    let character = chars.next().filter(char::is_ascii_alphanumeric)?;
    chars.next().is_none().then(|| character.to_string())
}

/// # Errors
/// [`StopPathError::InvalidChord`] unless the chord is modifiers plus
/// exactly one key with an XKB keysym name.
pub fn preferred_trigger(chord: &Chord) -> Result<String, StopPathError> {
    let invalid = || StopPathError::InvalidChord(chord.to_string());
    let mut held = [false; MODIFIERS.len()];
    let mut key = None;
    for name in chord.keys() {
        if let Some(index) = MODIFIERS
            .iter()
            .position(|(_, aliases)| aliases.contains(&name.as_str()))
        {
            if let Some(slot) = held.get_mut(index) {
                *slot = true;
            }
            continue;
        }
        let keysym = keysym_name(name)
            .or_else(|| single_char(name))
            .ok_or_else(invalid)?;
        if key.replace(keysym).is_some() {
            return Err(invalid());
        }
    }
    let key = key.ok_or_else(invalid)?;
    let mut parts: Vec<&str> = MODIFIERS
        .iter()
        .zip(held)
        .filter(|(_, held)| *held)
        .map(|((modifier, _), _)| *modifier)
        .collect();
    parts.push(&key);
    Ok(parts.join("+"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn trigger(chord: &str) -> Result<String, StopPathError> {
        preferred_trigger(&Chord::parse(chord).expect("chord parses"))
    }

    #[test]
    fn modifiers_come_out_canonical_whatever_the_configured_order() {
        assert_eq!(
            trigger("escape+shift+alt+ctrl").as_deref(),
            Ok("CTRL+ALT+SHIFT+Escape")
        );
        assert_eq!(trigger("cmd+opt+f12").as_deref(), Ok("ALT+LOGO+F12"));
        assert_eq!(trigger("ctrl+q").as_deref(), Ok("CTRL+q"));
    }

    #[test]
    fn a_chord_without_exactly_one_known_key_is_invalid() {
        for chord in ["ctrl+alt", "ctrl+a+b", "ctrl+hyperspace", "ctrl+f25"] {
            assert_eq!(
                trigger(chord),
                Err(StopPathError::InvalidChord(chord.to_owned())),
                "{chord}"
            );
        }
    }
}
