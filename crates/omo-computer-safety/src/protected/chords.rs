//! Key chords as the dangerous-chord table compares them: a modifier set and one key, with the
//! common spellings folded (`opt` = `option` = `alt`, `command` = `cmd`, `esc` = `escape`).

use std::collections::BTreeSet;

const MODIFIERS: &[(&str, &str)] = &[
    ("ctrl", "ctrl"),
    ("control", "ctrl"),
    ("alt", "alt"),
    ("opt", "alt"),
    ("option", "alt"),
    ("shift", "shift"),
    ("cmd", "cmd"),
    ("command", "cmd"),
    ("win", "win"),
    ("super", "win"),
    ("meta", "win"),
];

const KEYS: &[(&str, &str)] = &[("esc", "escape"), ("del", "delete"), ("return", "enter")];

/// A parsed chord.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chord {
    modifiers: BTreeSet<&'static str>,
    key: String,
}

impl Chord {
    /// `None` for an empty chord, an empty part or a chord with no non-modifier key.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let mut modifiers = BTreeSet::new();
        let mut key = None;
        for part in text.split('+') {
            let part = part.trim().to_ascii_lowercase();
            if part.is_empty() {
                return None;
            }
            if let Some((_, modifier)) = MODIFIERS.iter().find(|(name, _)| *name == part) {
                modifiers.insert(*modifier);
            } else if key.is_some() {
                return None;
            } else {
                let folded = KEYS
                    .iter()
                    .find(|(name, _)| *name == part)
                    .map_or(part.clone(), |(_, k)| (*k).to_owned());
                key = Some(folded);
            }
        }
        key.map(|key| Self { modifiers, key })
    }

    /// Whether this chord hits `entry`: the same key and the same modifiers, or a superset of
    /// them where the table says so.
    #[must_use]
    pub fn matches(&self, entry: &Self, supersets: bool) -> bool {
        self.key == entry.key
            && if supersets {
                self.modifiers.is_superset(&entry.modifiers)
            } else {
                self.modifiers == entry.modifiers
            }
    }
}
