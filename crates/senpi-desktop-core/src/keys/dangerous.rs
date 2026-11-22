//! Dangerous chords (DESIGN 2 A13): exactly `cmd+q`, `alt+f4` and `win+l`,
//! the chords that quit an app, close a window or lock the screen. An
//! object-mode session refuses them unless the request says `force: true`;
//! the chord itself is never changed, `force` only confirms the intent.

use super::KeyName;

/// The host family a backend runs on, which decides what `cmd`/`win` (both
/// [`KeyName::Meta`]) mean: `meta+l` focuses an address bar on macOS and
/// locks the screen on Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChordHost {
    /// macOS (`quartz`): `cmd+q`.
    Mac,
    /// Windows and Linux desktops: `alt+f4` and `win+l`.
    Pc,
    /// A backend that names no host (the fake): all three.
    Any,
}

impl ChordHost {
    /// The host family of a backend by its capabilities' `backend` name.
    #[must_use]
    pub fn of_backend(backend: &str) -> Self {
        match backend {
            "quartz" => Self::Mac,
            "win32" | "x11" | "wayland" => Self::Pc,
            _ => Self::Any,
        }
    }
}

const MAC_QUIT: [KeyName; 2] = [KeyName::Meta, KeyName::Char('q')];
const CLOSE_WINDOW: [KeyName; 2] = [KeyName::Alt, KeyName::F4];
const LOCK_SCREEN: [KeyName; 2] = [KeyName::Meta, KeyName::Char('l')];

/// The dangerous chord `keys` press on `host`, spelled as the design names
/// it, or `None`. Only the exact key set counts: `cmd+shift+q` is another
/// chord.
#[must_use]
pub fn dangerous_chord(keys: &[KeyName], host: ChordHost) -> Option<&'static str> {
    let candidates: &[(&[KeyName; 2], &'static str)] = match host {
        ChordHost::Mac => &[(&MAC_QUIT, "cmd+q")],
        ChordHost::Pc => &[(&CLOSE_WINDOW, "alt+f4"), (&LOCK_SCREEN, "win+l")],
        ChordHost::Any => &[(&MAC_QUIT, "cmd+q"), (&CLOSE_WINDOW, "alt+f4"), (&LOCK_SCREEN, "win+l")],
    };
    candidates
        .iter()
        .find(|(chord, _)| same_set(keys, chord.as_slice()))
        .map(|(_, name)| *name)
}

fn same_set(keys: &[KeyName], chord: &[KeyName]) -> bool {
    keys.iter().all(|key| chord.contains(key)) && chord.iter().all(|key| keys.contains(key))
}

#[cfg(test)]
mod tests {
    use super::{dangerous_chord, ChordHost};
    use crate::keys::parse_keys;

    fn chord(keys: &[&str], host: ChordHost) -> Option<&'static str> {
        let keys: Vec<String> = keys.iter().map(|key| (*key).to_owned()).collect();
        dangerous_chord(&parse_keys(&keys).expect("keys parse"), host)
    }

    #[test]
    fn exactly_the_three_design_chords_are_dangerous_on_a_host_that_names_none() {
        // Given / When / Then
        assert_eq!(chord(&["cmd+q"], ChordHost::Any), Some("cmd+q"));
        assert_eq!(chord(&["Q+Command"], ChordHost::Any), Some("cmd+q"));
        assert_eq!(chord(&["alt", "f4"], ChordHost::Any), Some("alt+f4"));
        assert_eq!(chord(&["win+l"], ChordHost::Any), Some("win+l"));
        assert_eq!(chord(&["cmd+shift+q"], ChordHost::Any), None);
        assert_eq!(chord(&["ctrl+q"], ChordHost::Any), None);
        assert_eq!(chord(&["q"], ChordHost::Any), None);
        assert_eq!(chord(&["f4"], ChordHost::Any), None);
    }

    #[test]
    fn meta_chords_follow_the_host() {
        // Given / When / Then: cmd+l focuses an address bar on macOS.
        assert_eq!(chord(&["cmd+q"], ChordHost::Mac), Some("cmd+q"));
        assert_eq!(chord(&["cmd+l"], ChordHost::Mac), None);
        assert_eq!(chord(&["alt+f4"], ChordHost::Mac), None);
        assert_eq!(chord(&["win+l"], ChordHost::Pc), Some("win+l"));
        assert_eq!(chord(&["alt+f4"], ChordHost::Pc), Some("alt+f4"));
        assert_eq!(chord(&["cmd+q"], ChordHost::Pc), None);
        assert_eq!(ChordHost::of_backend("quartz"), ChordHost::Mac);
        assert_eq!(ChordHost::of_backend("x11"), ChordHost::Pc);
        assert_eq!(ChordHost::of_backend("fake"), ChordHost::Any);
    }
}
