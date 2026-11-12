//! Binding a per-app scope at `session.open`: every name must bind to an app key the hand can
//! resolve (bundle id / AUMID / `WM_CLASS`); a name that cannot bind refuses the open
//! `InvalidTarget{app_unknown}` (GTS-12 shape) instead of silently scoping to nothing.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

/// The refusal of a scope name that binds to no app key.
pub const UNBOUND_SCOPE: Refusal = Refusal::new(EngineCode::InvalidTarget, Reason::AppUnknown.wire());

/// The scope as the keys it bound to.
///
/// # Errors
/// [`UNBOUND_SCOPE`] for the first name no known app key matches.
pub fn bind_scope(names: &[String], known_keys: &[String]) -> Result<Vec<String>, Refusal> {
    names
        .iter()
        .map(|name| {
            known_keys
                .iter()
                .find(|key| key.eq_ignore_ascii_case(name))
                .cloned()
                .ok_or(UNBOUND_SCOPE)
        })
        .collect()
}
