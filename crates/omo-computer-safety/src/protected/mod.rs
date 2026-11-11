//! The shipped protected-target table: read-only data, one versioned file per OS, with three
//! disjoint surface columns, the protected processes, the denied apps and the dangerous chords.
//! `force` admits exactly the listed chords and nothing else in the table.

mod chords;

use std::sync::OnceLock;

use serde::Deserialize;

pub use chords::Chord;

use crate::gate::Identity;

/// The OS a table belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Macos,
    Linux,
    Windows,
}

impl Os {
    pub const ALL: [Self; 3] = [Self::Macos, Self::Linux, Self::Windows];

    /// The OS the engine runs on (Linux for every other Unix).
    #[must_use]
    pub const fn host() -> Self {
        if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(windows) {
            Self::Windows
        } else {
            Self::Linux
        }
    }
}

/// One OS's table.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtectedTable {
    pub v: u32,
    pub os: String,
    /// Never an exec target on any route: `InvalidTarget{protected_surface}`.
    pub protected_surfaces: Vec<String>,
    /// Reads admitted, every exec refused `InvalidTarget{protected_surface}`.
    pub read_only_surfaces: Vec<String>,
    /// The OS shell: admitted as a desktop-class target the Grant stage decides.
    pub system_surfaces: Vec<String>,
    /// Never quit: `ProtectedProcess`.
    pub processes: Vec<String>,
    /// Refused `ControlRequired{denied_app}` unless `consent.apps.allow` names the entry.
    pub denied_apps: Vec<String>,
    /// Refused `InvalidKey{dangerous_chord}` without `force`.
    pub dangerous_chords: Vec<String>,
    /// Whether a chord with extra modifiers still matches an entry.
    pub chords_match_supersets: bool,
    pub secure_label_regex: String,
    pub secure_input_sources: Vec<String>,
}

const MACOS: &str = include_str!("macos.json");
const LINUX: &str = include_str!("linux.json");
const WINDOWS: &str = include_str!("windows.json");

impl ProtectedTable {
    /// The shipped table of `os` (parsed once; the table test proves every file parses).
    ///
    /// # Panics
    /// A shipped table file does not parse.
    #[must_use]
    pub fn of(os: Os) -> &'static Self {
        static TABLES: OnceLock<[ProtectedTable; 3]> = OnceLock::new();
        let tables = TABLES.get_or_init(|| {
            [MACOS, LINUX, WINDOWS].map(|text| {
                serde_json::from_str(text)
                    .unwrap_or_else(|error| panic!("shipped protected-target table: {error}"))
            })
        });
        &tables[os as usize]
    }

    /// `protectedSurfaces`, and `readOnlySurfaces` for an exec verb.
    #[must_use]
    pub fn is_protected_surface(&self, identity: &Identity, exec: bool) -> bool {
        matches_any(&self.protected_surfaces, identity, Unnamed::Protected)
            || (exec && matches_any(&self.read_only_surfaces, identity, Unnamed::Protected))
    }

    #[must_use]
    pub fn is_protected_process(&self, identity: &Identity) -> bool {
        matches_any(&self.processes, identity, Unnamed::Protected)
    }

    /// A surface-qualified entry here names only that surface of its host app.
    #[must_use]
    pub fn is_denied_app(&self, identity: &Identity) -> bool {
        matches_any(&self.denied_apps, identity, Unnamed::Other)
    }

    /// Whether `chord` is a listed dangerous chord (an unparsable chord never is: the key
    /// grammar refuses it first).
    #[must_use]
    pub fn is_dangerous_chord(&self, chord: &str) -> bool {
        // RED: the chord table is not consulted yet.
        if !chord.is_empty() {
            return false;
        }
        let Some(chord) = Chord::parse(chord) else {
            return false;
        };
        self.dangerous_chords
            .iter()
            .filter_map(|entry| Chord::parse(entry))
            .any(|entry| chord.matches(&entry, self.chords_match_supersets))
    }
}

/// How a surface-qualified entry reads a target whose OS reports no surface.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Unnamed {
    /// An unnamed surface of an owner that draws protected UI fails closed.
    Protected,
    Other,
}

/// An entry is an app key (`*` at the end matches a prefix) or `app:surface`.
fn entry_matches(entry: &str, identity: &Identity, unnamed: Unnamed) -> bool {
    let key = |pattern: &str| match pattern.strip_suffix('*') {
        Some(prefix) => identity
            .app_key
            .to_ascii_lowercase()
            .starts_with(&prefix.to_ascii_lowercase()),
        None => identity.app_key.eq_ignore_ascii_case(pattern),
    };
    match entry.split_once(':') {
        None => key(entry),
        Some((app, surface)) => {
            key(app)
                && identity
                    .surface
                    .as_deref()
                    .map_or(unnamed == Unnamed::Protected, |actual| {
                        actual.eq_ignore_ascii_case(surface)
                    })
        }
    }
}

fn matches_any(entries: &[String], identity: &Identity, unnamed: Unnamed) -> bool {
    entries
        .iter()
        .any(|entry| entry_matches(entry, identity, unnamed))
}

#[cfg(test)]
mod tests;
