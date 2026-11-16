//! The interaction lock one exec acts under (row 21, A-IS-65 L10(b); moved out of funnel/mod.rs
//! to keep it under the 250-line cap, R65a).

use omo_computer_core::env::FAKE_BACKEND;

use crate::Session;

impl Session {
    /// The interaction lock for this exec. A session with no RUNTIME root has none; only the
    /// fake acts without it, and any other backend is refused (A-IS-65 L10(b)).
    pub(super) fn interaction_lock(&self) -> std::io::Result<Option<crate::lock::LockGuard>> {
        match self.funnel.lock.as_ref() {
            Some(lock) => lock.acquire().map(Some),
            None if self.backend.capabilities().backend == FAKE_BACKEND => Ok(None),
            None => Err(std::io::Error::other(
                "no runtime root: a real backend acts only under the interaction lock",
            )),
        }
    }
}
