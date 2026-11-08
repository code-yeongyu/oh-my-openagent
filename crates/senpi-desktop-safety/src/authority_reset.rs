//! The local half of an authority activation, not a user resume token.
//!
//! No production constructor is exposed until the authenticated broker client
//! can validate the complete instance/transaction binding. A numeric generation
//! or a legacy token must never be promoted into this proof by a caller.
use std::sync::Arc;

use crate::supervisor::authority::AuthorityAdmission;

/// Opaque, single-use proof for one supervisor's exact stopped word.
/// Deliberately not Clone and not constructible by downstream crates.
///
/// ```compile_fail
/// use senpi_desktop_safety::AuthorityReset;
/// let forged = AuthorityReset { stopped_word: 1 };
/// ```
pub struct AuthorityReset {
    pub(crate) admission: Arc<AuthorityAdmission>,
    pub(crate) stopped_word: u64,
}

/// A rejected activation never retries against a newer stopped generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AuthorityResetError {
    #[error("the activation belongs to another supervisor")]
    WrongSupervisor,
    #[error("the captured stop has not completed release and durable commit")]
    UncommittedStop,
    #[error("the captured stop is no longer current")]
    StaleStop,
    #[error("stop generation is exhausted; a new engine instance is required")]
    Exhausted,
}
