//! The session's `(issuer, scope)` lease key and the secure predicate the redaction keys on.

use omo_computer_core::backend::Backend;
use omo_computer_core::session_state::Tristate;

/// The `(issuer, scope)` lease key of the session's calls.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub issuer: String,
    pub scope: String,
}

impl Default for Binding {
    fn default() -> Self {
        Self {
            issuer: "local".to_owned(),
            scope: "default".to_owned(),
        }
    }
}

/// The secure predicate the redaction table keys on.
pub trait SecureProbe: Send {
    fn secure(&self, backend: &dyn Backend, target: Option<&str>) -> bool;
}

/// Secure Input as the backend's session state reads it.
#[derive(Debug, Clone, Copy, Default)]
pub struct SecureInputProbe;

impl SecureProbe for SecureInputProbe {
    fn secure(&self, backend: &dyn Backend, _target: Option<&str>) -> bool {
        matches!(
            backend.capabilities().session.secure_input_active,
            Tristate::Known(true)
        )
    }
}

impl<F: Fn(Option<&str>) -> bool + Send> SecureProbe for F {
    fn secure(&self, _backend: &dyn Backend, target: Option<&str>) -> bool {
        self(target)
    }
}
