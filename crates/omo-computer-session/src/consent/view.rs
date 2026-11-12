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
        }
    }
}

impl ConsentView {
    /// The view a host wrote; a view that does not parse is treated as tampered.
    #[must_use]
    pub fn from_host(value: serde_json::Value) -> Self {
        serde_json::from_value(value).unwrap_or_else(|_| Self {
            tampered: true,
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
