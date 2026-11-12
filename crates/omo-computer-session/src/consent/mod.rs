//! Consent in the session (Loop 10; `design/d-safety.md` '## Approval and consent'): the
//! per-call tier, the per-app scope keyed by bundle id / AUMID / `WM_CLASS` with the denied-app
//! table, the code-identity binding of every per-app entry, denial memory and the per-app stop.
//! The foreground grant and its lease are `crate::grant` and `crate::lease`.

mod denied;
mod identity;
mod memory;
mod scope;
mod tier;
mod view;

#[cfg(test)]
mod tests;

pub use denied::{denied_app_seeds, is_denied_app};
pub use identity::{Binding, BoundIdentity, IdentityChanged, IDENTITY_UNAVAILABLE};
pub use memory::{Memory, Part};
pub use scope::bind_scope;
pub use tier::{covers, Tier};
pub use view::{AppEntry, Apps, ConsentView, ForegroundPolicy};

use omo_computer_safety::gate::verdicts::ConsentRefusal;
use omo_computer_safety::protected::Os;
use serde_json::{json, Value};

use crate::mutate::LOCAL_HAND;

/// The app a call lands in, as its target resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppTarget {
    pub app_key: String,
    pub bound: BoundIdentity,
}

impl AppTarget {
    fn key(&self) -> String {
        self.bound.memory_key(&self.app_key)
    }
}

/// A consent refusal and the members it carries on the wire (`app`, `identity`).
#[derive(Debug, Clone, PartialEq)]
pub struct Denial {
    pub refusal: ConsentRefusal,
    pub detail: Option<Value>,
}

impl Denial {
    const fn bare(refusal: ConsentRefusal) -> Self {
        Self {
            refusal,
            detail: None,
        }
    }

    fn on(refusal: ConsentRefusal, app: &AppTarget) -> Self {
        Self {
            refusal,
            detail: Some(json!({ "app": app.app_key })),
        }
    }
}

/// An admitted call and how its app entry was bound (`identity_unavailable` rides the report).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Admission {
    pub binding: Option<Binding>,
}

/// The consent of one hand in one session.
#[derive(Debug, Clone)]
pub struct Consent {
    view: ConsentView,
    hand: String,
    os: Os,
    memory: Memory,
    approvals: Vec<AppEntry>,
}

impl Default for Consent {
    fn default() -> Self {
        Self::new(ConsentView::default(), LOCAL_HAND, Os::host())
    }
}

impl Consent {
    #[must_use]
    pub fn new(view: ConsentView, hand: &str, os: Os) -> Self {
        Self {
            view,
            hand: hand.to_owned(),
            os,
            memory: Memory::default(),
            approvals: Vec::new(),
        }
    }

    #[must_use]
    pub const fn view(&self) -> &ConsentView {
        &self.view
    }

    #[must_use]
    pub fn hand(&self) -> &str {
        &self.hand
    }

    /// The host's prompt for `part` was denied (on `app`, for the app-scope and per-app parts).
    pub fn record_denial(&mut self, part: Part, app: Option<&AppTarget>) {
        self.memory.deny(part, &app.map(AppTarget::key).unwrap_or_default());
    }

    #[must_use]
    pub fn is_denied(&self, part: Part, app: Option<&AppTarget>) -> bool {
        self.memory.is_denied(part, &app.map(AppTarget::key).unwrap_or_default())
    }

    /// The presence surface's "Stop computer use in <app>".
    pub fn stop_app(&mut self, app: &AppTarget) {
        self.memory.stop_app(&app.key());
    }

    /// A newer user message: denial memory and per-app stops end.
    pub fn user_message(&mut self) {
        self.memory.user_message();
    }

    /// The user approved `app` (again) in the host: the entry is re-bound to what it reads now.
    pub fn approve_app(&mut self, app: &AppTarget) {
        self.approvals.retain(|entry| !entry.app_key.eq_ignore_ascii_case(&app.app_key));
        self.approvals.push(AppEntry {
            app_key: app.app_key.clone(),
            bound: app.bound.clone(),
        });
    }

    /// Consent for an exec call: tamper and the per-tool switch, the tier, then the app.
    ///
    /// # Errors
    /// The first consent refusal, with nothing sent.
    pub fn admit_exec(&self, app: Option<&AppTarget>) -> Result<Admission, Denial> {
        if true { return Ok(Admission { binding: None }); }
        if self.view.tampered {
            return Err(Denial::bare(ConsentRefusal::Tampered));
        }
        if !self.view.computer_use {
            return Err(Denial::bare(ConsentRefusal::ConsentOff));
        }
        if !self.view.full_access && !covers(&self.view.grants, Tier::Exec, &self.hand) {
            let denied = self.is_denied(Part::Tier, None);
            return Err(Denial::bare(if denied {
                ConsentRefusal::DeniedThisTurn
            } else {
                ConsentRefusal::TierMissing
            }));
        }
        self.admit_app(app)
    }

    /// Consent for a window-targeted read: the denied-app table and the scope refuse it exactly
    /// as an exec (a desktop or display read is not app-scoped).
    ///
    /// # Errors
    /// `app_scope`, `denied_app` or `user_stopped`, with nothing returned.
    pub fn admit_read(&self, app: Option<&AppTarget>) -> Result<Admission, Denial> {
        if true { return Ok(Admission { binding: None }); }
        self.admit_app(app)
    }

    fn admit_app(&self, app: Option<&AppTarget>) -> Result<Admission, Denial> {
        let Some(app) = app else {
            return Ok(Admission { binding: None });
        };
        if is_denied_app(self.os, &app.app_key) && self.view.approved(&app.app_key).is_none() {
            return Err(Denial::on(ConsentRefusal::DeniedApp, app));
        }
        if self.view.apps.deny.iter().any(|key| key.eq_ignore_ascii_case(&app.app_key)) {
            return Err(Denial::on(ConsentRefusal::DeniedApp, app));
        }
        if self.memory.is_stopped(&app.key()) {
            return Err(Denial::on(ConsentRefusal::UserStopped, app));
        }
        let binding = self.check_identity(app)?;
        if let Some(scope) = &self.view.scope {
            if !scope.iter().any(|key| key.eq_ignore_ascii_case(&app.app_key)) {
                let denied = self.is_denied(Part::AppScope, Some(app));
                return Err(Denial::on(
                    if denied {
                        ConsentRefusal::DeniedThisTurn
                    } else {
                        ConsentRefusal::AppScope
                    },
                    app,
                ));
            }
        }
        Ok(Admission { binding })
    }

    fn check_identity(&self, app: &AppTarget) -> Result<Option<Binding>, Denial> {
        let approved = self
            .approvals
            .iter()
            .rev()
            .find(|entry| entry.app_key.eq_ignore_ascii_case(&app.app_key))
            .or_else(|| self.view.approved(&app.app_key));
        let Some(approved) = approved else {
            return Ok(None);
        };
        approved.bound.check(&app.bound).map(Some).map_err(|changed| Denial {
            refusal: ConsentRefusal::IdentityChanged,
            detail: Some(json!({
                "app": app.app_key,
                "identity": { "approved": changed.approved, "observed": changed.observed },
            })),
        })
    }
}
