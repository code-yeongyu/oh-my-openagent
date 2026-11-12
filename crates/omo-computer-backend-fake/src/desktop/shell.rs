//! The fake host's consent view (row 21), kept beside the fake's `Backend` impl.

use crate::backend::FakeBackend;

impl FakeBackend {
    /// The scenario's `consent` block, with `fullAccess` set when the scenario scripts the
    /// full-access preset; neither present is no host view.
    pub(super) fn fake_host_consent(&self) -> Option<serde_json::Value> {
        let state = self.lock();
        let full_access = state.scenario.full_access_preset;
        match state.scenario.consent.clone() {
            Some(serde_json::Value::Object(mut view)) => {
                if full_access {
                    view.insert("fullAccess".to_owned(), serde_json::Value::Bool(true));
                }
                Some(serde_json::Value::Object(view))
            }
            Some(other) => Some(other),
            None => full_access.then(|| serde_json::json!({ "fullAccess": true })),
        }
    }
}
