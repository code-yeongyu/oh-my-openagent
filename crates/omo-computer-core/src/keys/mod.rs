//! The keysym grammar of `key.down`/`key.up` and `holdKeys`: a chord is `+`-joined names,
//! each a modifier, a named key, a function key or one character; aliases read to one name.

/// A chord that does not parse, refused `InvalidKey` before any input is sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BadKey {
    pub token: String,
}

const NAMED: [&str; 18] = [
    "shift", "ctrl", "alt", "cmd", "return", "tab", "escape", "space", "backspace", "delete", "up",
    "down", "left", "right", "home", "end", "pageup", "pagedown",
];

const ALIASES: [(&str, &str); 9] = [
    ("control", "ctrl"),
    ("option", "alt"),
    ("command", "cmd"),
    ("meta", "cmd"),
    ("super", "cmd"),
    ("win", "cmd"),
    ("enter", "return"),
    ("esc", "escape"),
    ("del", "delete"),
];

/// The key names of `chord`, in press order.
///
/// # Errors
/// [`BadKey`] naming the first token that is empty or not a key.
pub fn chord_keys(chord: &str) -> Result<Vec<String>, BadKey> {
    chord.split('+').map(key_name).collect()
}

/// One key name, read to its canonical spelling.
///
/// # Errors
/// [`BadKey`] for an empty or unknown token.
pub fn key_name(token: &str) -> Result<String, BadKey> {
    let lower = token.trim().to_lowercase();
    let name = ALIASES.iter().find(|(alias, _)| *alias == lower).map_or(lower.as_str(), |(_, name)| name);
    let single = name.chars().count() == 1;
    let function = name.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()).is_some_and(|n| (1..=24).contains(&n));
    if single || function || NAMED.contains(&name) {
        Ok(name.to_owned())
    } else {
        Err(BadKey { token: token.to_owned() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_chord_reads_aliases_to_one_name_in_press_order() {
        assert_eq!(chord_keys("Control+Shift+a"), Ok(vec!["ctrl".into(), "shift".into(), "a".into()]));
        assert_eq!(chord_keys("cmd+F12"), Ok(vec!["cmd".into(), "f12".into()]));
        assert_eq!(key_name("Enter"), Ok("return".into()));
    }

    #[test]
    fn an_empty_or_unknown_token_is_refused_by_name() {
        assert_eq!(chord_keys("ctrl+"), Err(BadKey { token: String::new() }));
        assert_eq!(chord_keys("hyper+a"), Err(BadKey { token: "hyper".into() }));
        assert_eq!(key_name("f25"), Err(BadKey { token: "f25".into() }));
    }
}
