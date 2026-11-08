//! User-only resume proof. [`crate::Supervisor::reset`] takes a [`UserReset`],
//! and the only way to obtain one is to redeem the engine's [`ResumeToken`]
//! with the matching secret, which only the host that opened the session holds
//! (`stopPath.resume {token}`). No model-facing chain can carry it.

/// Proof that the user asked to lift suspension. Not constructible outside
/// this crate except through [`ResumeToken::redeem`].
pub struct UserReset {
    _sealed: (),
}

/// The per-process resume secret the engine hands to its host.
pub struct ResumeToken(String);

impl ResumeToken {
    #[must_use]
    pub const fn new(secret: String) -> Self {
        Self(secret)
    }

    /// The secret, for the `session.open` reply to the host only.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// A [`UserReset`] when `presented` matches the secret, otherwise `None`.
    #[must_use]
    pub fn redeem(&self, presented: &str) -> Option<UserReset> {
        (presented == self.0).then_some(UserReset { _sealed: () })
    }
}
