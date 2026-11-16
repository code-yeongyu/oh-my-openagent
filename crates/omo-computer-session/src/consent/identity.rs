//! Consent bound to code identity (contract principle 6, acceptance 97; design row C24).
//!
//! Every per-app consent entry records the target's code identity at grant - macOS team id +
//! cdhash, Windows image path + Authenticode signer (or the image hash when unsigned), Linux
//! executable path + hash - and a later target under the same app key whose identity differs
//! is refused `ControlRequired{identity_changed, app, identity:{approved, observed}}` with
//! nothing sent. An identity that cannot be read binds the entry to the path alone
//! (`identity_unavailable`).

use omo_computer_core::listing::CodeIdentity;
use serde::{Deserialize, Serialize};

/// What a consent entry is bound to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundIdentity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// `None`: the identity could not be read at grant (`identity_unavailable`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<CodeIdentity>,
}

/// The reason a binding without a readable identity carries on the report.
pub const IDENTITY_UNAVAILABLE: &str = "identity_unavailable";

impl BoundIdentity {
    #[must_use]
    pub const fn new(path: Option<String>, identity: Option<CodeIdentity>) -> Self {
        Self { path, identity }
    }

    /// True when the identity half could not be read.
    #[must_use]
    pub const fn is_unavailable(&self) -> bool {
        self.identity.is_none()
    }

    /// An entry carrying neither an identity nor a path: no grant (A-IS-61). It is never honoured
    /// and never bound, removed or rewritten by the engine; only the user's re-approval binds it.
    #[must_use]
    pub fn is_unbound(&self) -> bool {
        self.path.is_none() && self.identity.as_ref().is_none_or(is_empty)
    }

    /// Admission at use (A-IS-61, d-safety.md:413): an entry bound to an identity admits only a
    /// target whose identity was read in full and is equal in every member, and never falls back to
    /// the path; an entry bound to the path alone admits only a target whose path was read and is
    /// equal (`identity_unavailable`); an unbound entry admits nothing.
    ///
    /// # Errors
    /// [`IdentityChanged`] in every other case, `observed` naming what could not be read.
    pub fn check(&self, observed: &Self) -> Result<Binding, Box<IdentityChanged>> {
        if let Some(approved) = self.identity.as_ref().filter(|id| !is_empty(id)) {
            return match &observed.identity {
                Some(seen) if same_code(approved, seen) => Ok(Binding::Identity),
                _ => Err(self.changed(observed)),
            };
        }
        match (&self.path, &observed.path) {
            (Some(approved), Some(seen)) if approved == seen => Ok(Binding::PathOnly),
            _ => Err(self.changed(observed)),
        }
    }

    fn changed(&self, observed: &Self) -> Box<IdentityChanged> {
        Box::new(IdentityChanged {
            approved: self.clone(),
            observed: observed.clone(),
        })
    }

    /// The key the per-app stop and the denial memory use: the same app key under another
    /// identity is another key (a stop recorded for one cdhash does not cover another copy).
    #[must_use]
    pub fn memory_key(&self, app_key: &str) -> String {
        let code = self.identity.as_ref().map_or_else(String::new, |id| {
            [&id.team_id, &id.cdhash, &id.signer, &id.hash]
                .iter()
                .map(|part| part.as_deref().unwrap_or(""))
                .collect::<Vec<_>>()
                .join(":")
        });
        format!("{}|{}|{code}", app_key.to_ascii_lowercase(), self.path.as_deref().unwrap_or(""))
    }
}

/// How an admitted entry was bound.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Binding {
    Identity,
    /// `identity_unavailable`: the path alone; the reason rides on the report.
    PathOnly,
}

/// A differing copy under an approved app key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentityChanged {
    pub approved: BoundIdentity,
    pub observed: BoundIdentity,
}

/// An identity with no member read is no identity.
const fn is_empty(id: &CodeIdentity) -> bool {
    id.team_id.is_none() && id.cdhash.is_none() && id.signer.is_none() && id.hash.is_none()
}

fn same_code(approved: &CodeIdentity, seen: &CodeIdentity) -> bool {
    approved == seen
}
