//! Immediate authority admission is independent of durable stop publication.
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

use super::Supervisor;
use crate::{AuthorityReset, AuthorityResetError, Clock};

pub(crate) const MAX_GENERATION: u64 = u64::MAX >> 1;

pub(crate) struct AuthorityAdmission {
    pub(super) word: AtomicU64,
    pub(super) committed_through: AtomicU64,
    pub(super) commit: Arc<dyn Fn(u64) + Send + Sync>,
}

impl AuthorityAdmission {
    pub(super) fn request_stop(&self) {
        let mut current = self.word.load(Ordering::SeqCst);
        loop {
            // Adding to the stopped representation preserves its low bit;
            // saturation makes (MAX, stopped) absorbing without wrap or ABA.
            let next = (current | 1).saturating_add(2);
            match self
                .word
                .compare_exchange(current, next, Ordering::SeqCst, Ordering::SeqCst)
            {
                Ok(_) => return,
                Err(observed) => current = observed,
            }
        }
    }

    pub(super) fn generation(&self) -> u64 {
        self.word.load(Ordering::SeqCst) >> 1
    }

    pub(super) fn is_suspended(&self) -> bool {
        self.word.load(Ordering::SeqCst) & 1 != 0
    }
}

impl Supervisor {
    /// A suspended authority owner. The callback must durably commit coverage
    /// through the supplied local generation or terminate without returning.
    /// No existing launch mode selects this constructor. Broker integration
    /// must supply authenticated activation proofs before selecting it.
    #[must_use]
    pub fn with_stop_authority(
        clock: Arc<dyn Clock>,
        commit: impl Fn(u64) + Send + Sync + 'static,
    ) -> Self {
        let mut supervisor = Self::new(clock);
        supervisor.authority = Some(Arc::new(AuthorityAdmission {
            word: AtomicU64::new(1),
            committed_through: AtomicU64::new(0),
            commit: Arc::new(commit),
        }));
        supervisor.bounded_release.store(true, Ordering::SeqCst);
        supervisor.published.store(true, Ordering::SeqCst);
        supervisor
    }

    /// Consume a validated activation. This exact-word CAS is the ONLY enable
    /// path for authority mode; legacy/test reset cannot bypass it.
    ///
    /// # Errors
    /// Stale, uncovered, exhausted or foreign proofs leave admission untouched.
    pub fn activate_authority(&self, proof: AuthorityReset) -> Result<(), AuthorityResetError> {
        let Some(admission) = &self.authority else {
            return Err(AuthorityResetError::WrongSupervisor);
        };
        if !Arc::ptr_eq(admission, &proof.admission) {
            return Err(AuthorityResetError::WrongSupervisor);
        }
        let _commit = self.stop_commit_lock.lock();
        let generation = proof.stopped_word >> 1;
        if generation == MAX_GENERATION {
            return Err(AuthorityResetError::Exhausted);
        }
        if admission.committed_through.load(Ordering::SeqCst) < generation {
            return Err(AuthorityResetError::UncommittedStop);
        }
        if proof.stopped_word & 1 == 0
            || admission.word.load(Ordering::SeqCst) != proof.stopped_word
        {
            return Err(AuthorityResetError::StaleStop);
        }
        // Epoch consumers invalidate held scopes and pre-stop control grants
        // before admission can open. Operation approvals are broker-client work.
        self.stop_epoch.fetch_add(1, Ordering::SeqCst);
        #[cfg(test)]
        if let Some(hook) = self.activation_hook.lock().take() {
            hook();
        }
        admission
            .word
            .compare_exchange(
                proof.stopped_word,
                proof.stopped_word & !1,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .map_err(|_| AuthorityResetError::StaleStop)?;
        *self.stopped_by.lock() = None;
        self.published.store(false, Ordering::SeqCst);
        Ok(())
    }
}
