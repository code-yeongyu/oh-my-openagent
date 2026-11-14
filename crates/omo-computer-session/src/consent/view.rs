//! The read-only consent view the hand tool host hands the engine at `session.open`
//! (`design/d-safety.md` '### Consent store and fingerprint'). The session may only narrow it.

use serde::Deserialize;

use super::identity::BoundIdentity;

/// `consent.foreground`: `granted` is reserved for Q card X5 and reads as `policy` until then.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForegroundPolicy {
    Never,
    #[default]
    Policy,
    Granted,
}

/// One allowed app, bound to the code identity recorded when it was granted.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    pub app_key: String,
    #[serde(flatten)]
    pub bound: BoundIdentity,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(default)]
pub struct Apps {
    pub allow: Vec<AppEntry>,
    pub deny: Vec<String>,
}

/// The view. Defaults are the bootstrap defaults of a fresh hand plus the stored local tier
/// grants a v1 session runs under, so a host that hands no view changes no existing reply.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConsentView {
    pub computer_use: bool,
    pub foreground: ForegroundPolicy,
    pub apps: Apps,
    /// The per-app scope of the session: `None` is unscoped.
    pub scope: Option<Vec<String>>,
    /// Stored tier keys: `computer:read`, `computer:exec`, `computer:exec@<handId>`, ...
    pub grants: Vec<String>,
    /// The session's permission preset is full access.
    pub full_access: bool,
    /// The file differs from the host's last write: exec refused, reads continue.
    pub tampered: bool,
    pub foreground_input_lock: bool,
    /// `stopHotkey` as carried by the handed view (A-IS-62 rev 5, R70ao(2)): `None` = the member is
    /// NOT carried (unreadable), `Some(None)` = JSON null, absent in the file (the OS default),
    /// `Some(Some(chord))` = the configured chord.
    #[serde(default = "not_carried", deserialize_with = "carried")]
    pub stop_hotkey: Option<Option<String>>,
}

impl Default for ConsentView {
    fn default() -> Self {
        Self {
            computer_use: true,
            foreground: ForegroundPolicy::Policy,
            apps: Apps::default(),
            scope: None,
            grants: vec!["computer:read".to_owned(), "computer:exec".to_owned()],
            full_access: false,
            tampered: false,
            foreground_input_lock: false,
            // A view built in code models "absent in the file" (R70ao(2)).
            stop_hotkey: Some(None),
        }
    }
}

const fn not_carried() -> Option<Option<String>> {
    None
}

fn carried<'de, D: serde::Deserializer<'de>>(de: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(de).map(Some)
}

/// The stop chord the consent file names (A-IS-62).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopChord {
    /// A parseable chord, or the documented OS default when the key is absent.
    Chord(String),
    /// Not a chord: it never falls back to the default (the listener reads deaf on it).
    Unparseable(String),
    /// The view did not carry the member: nothing is equal and every exec is refused (R70an B).
    Unreadable,
}

/// The documented default `computer.stopHotkey` per OS (`design/d-safety.md`:84).
#[must_use]
pub const fn default_stop_hotkey(os: omo_computer_safety::protected::Os) -> &'static str {
    match os {
        omo_computer_safety::protected::Os::Macos => "ctrl+opt+cmd+escape",
        omo_computer_safety::protected::Os::Linux | omo_computer_safety::protected::Os::Windows => {
            "ctrl+alt+shift+escape"
        }
    }
}

impl ConsentView {
    /// The stop chord this view names on `os`: absent is the OS default; an unparseable value is
    /// not a chord and never the default (A-IS-62).
    #[must_use]
    pub fn stop_chord(&self, os: omo_computer_safety::protected::Os) -> StopChord {
        match &self.stop_hotkey {
            None => StopChord::Unreadable,
            Some(None) => StopChord::Chord(default_stop_hotkey(os).to_owned()),
            // Review L6: the parser's canonical spelling, the one the backend is sent and the
            // re-arm compares.
            Some(Some(text)) => omo_computer_safety::protected::Chord::parse(text)
                .map_or_else(|| StopChord::Unparseable(text.clone()), |chord| StopChord::Chord(chord.canonical())),
        }
    }

    /// Whether `requested` is the configured stop chord on `os`, compared through the engine's
    /// ONE chord parser (A-IS-62 rev 5): spelling, case and order fold; an unparseable chord on
    /// either side equals nothing.
    #[must_use]
    pub fn same_stop_chord(&self, os: omo_computer_safety::protected::Os, requested: &str) -> bool {
        let StopChord::Chord(configured) = self.stop_chord(os) else {
            return false;
        };
        let parse = omo_computer_safety::protected::Chord::parse;
        matches!((parse(&configured), parse(requested)), (Some(a), Some(b)) if a == b)
    }

    /// The view a host wrote; a view that does not parse is treated as tampered. Its stopHotkey
    /// keeps the member's own state (review L2, A-IS-62): missing is not carried, null is the OS
    /// default, and any other value that is not a string is "not a chord", never the default.
    #[must_use]
    pub fn from_host(value: serde_json::Value) -> Self {
        let stop_hotkey = match value.get("stopHotkey") {
            None => None,
            Some(serde_json::Value::Null) => Some(None),
            Some(serde_json::Value::String(text)) => Some(Some(text.clone())),
            // The raw text alone could parse (`5` is a key), so it ends in an empty key segment,
            // which the engine's one parser refuses: the value is kept as "not a chord".
            Some(other) => Some(Some(format!("{other}+"))),
        };
        serde_json::from_value(value).unwrap_or_else(|_| Self {
            tampered: true,
            stop_hotkey,
            ..Self::default()
        })
    }

    /// The approved binding of `app_key`, when the view recorded one.
    #[must_use]
    pub fn approved(&self, app_key: &str) -> Option<&AppEntry> {
        self.apps
            .allow
            .iter()
            .find(|entry| entry.app_key.eq_ignore_ascii_case(app_key))
    }

    /// `apps.allow` as the app keys the denied-app table lets through.
    #[must_use]
    pub fn allowed_keys(&self) -> Vec<String> {
        self.apps.allow.iter().map(|entry| entry.app_key.clone()).collect()
    }
}
