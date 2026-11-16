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

    /// The one spelling of this chord: modifiers in the order ctrl, alt, shift, cmd, win, then the
    /// key, joined by `+` (the documented default `ctrl+alt+shift+escape` is its own canonical
    /// form). Row 21, review L6: the stop chord is sent and compared in this spelling.
    #[must_use]
    pub fn canonical(&self) -> String {
        ["ctrl", "alt", "shift", "cmd", "win"]
            .into_iter()
            .filter(|modifier| self.modifiers.contains(modifier))
            .chain(std::iter::once(self.key.as_str()))
            .collect::<Vec<_>>()
            .join("+")
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

#[cfg(test)]
mod canonical_spelling {
    use super::Chord;

    /// Row 21, review L6: every spelling of one chord has one canonical form, and the documented
    /// default is its own canonical form.
    #[test]
    fn every_spelling_of_one_chord_has_one_canonical_form() {
        for text in [
            "ctrl+alt+shift+escape",
            " Shift+Ctrl+Opt+Esc ",
            "control+option+shift+esc",
        ] {
            assert_eq!(
                Chord::parse(text).map(|chord| chord.canonical()).as_deref(),
                Some("ctrl+alt+shift+escape"),
                "{text}"
            );
        }
        assert_eq!(
            Chord::parse("cmd+super+q")
                .map(|chord| chord.canonical())
                .as_deref(),
            Some("cmd+win+q")
        );
    }
}
