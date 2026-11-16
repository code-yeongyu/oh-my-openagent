//! The exec funnel's wait for the interaction lock (A-IS-66 W1-W6), driven on the backend's clock
//! seam (the process's monotonic clock when the backend has none).

use omo_computer_core::backend::{BackendClock, Refusal};
use omo_computer_core::env::FAKE_BACKEND;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_safety::SuspendReason;
use serde_json::json;

use super::super::{Refused, TRANSACTION_FAILED};
use crate::lock::wait::{LockWait, MonotonicClock, POLL_MS, WAIT_BUDGET_MS};
use crate::lock::LockGuard;
use crate::Session;

/// `InputBusy{reason:"interaction_lock"}`, an additive reason (A-IS-66 W3).
const INTERACTION_LOCK_BUSY: Refusal =
    Refusal::new(EngineCode::InputBusy, Reason::InteractionLock);

impl Session {
    /// The interaction lock for this exec, waited for at most the budget. A session with no
    /// RUNTIME root has none; only the fake acts without it (A-IS-65 L10(b)). Answers the refusal
    /// and its stage: `Lease` at the bound, the stop's own stage when a stop ends the wait, `Lock`
    /// for an unusable lock (A-IS-65 L2).
    pub(super) fn wait_for_interaction_lock(
        &mut self,
    ) -> Result<Option<LockGuard>, Box<(String, Refused)>> {
        let Some(lock) = self.funnel.lock.clone() else {
            if self.backend.capabilities().backend == FAKE_BACKEND {
                return Ok(None);
            }
            self.funnel
                .warn(
                    "interaction lock not taken: no runtime root: a real backend acts only under \
                     the interaction lock"
                        .to_owned(),
                );
            return Err(Box::new(("Lock".to_owned(), TRANSACTION_FAILED.into())));
        };
        let fallback = MonotonicClock::default();
        let now = |session: &Self| {
            session
                .backend
                .clock()
                .map_or_else(|| fallback.now_ms(), |clock| clock.now_ms())
        };
        let wait = LockWait::began(now(self));
        loop {
            match lock.try_acquire() {
                Ok(Some(guard)) => return Ok(Some(guard)),
                Ok(None) => {}
                Err(error) => {
                    self.funnel.warn(format!("interaction lock not taken: {error}"));
                    return Err(Box::new(("Lock".to_owned(), TRANSACTION_FAILED.into())));
                }
            }
            if let Some(refusal) = self.stop_while_waiting() {
                return Err(Box::new(("Latch".to_owned(), refusal.into())));
            }
            if let Some(waited_ms) = wait.at_bound(now(self)) {
                let out = Refused {
                    detail: Some(Box::new(json!({
                        "waitedMs": waited_ms,
                        "retryAfterMs": WAIT_BUDGET_MS,
                    }))),
                    ..INTERACTION_LOCK_BUSY.into()
                };
                return Err(Box::new(("Lease".to_owned(), out)));
            }
            match self.backend.clock() {
                Some(clock) => clock.wait_ms(POLL_MS),
                None => fallback.wait_ms(POLL_MS),
            }
        }
    }

    /// W4: every stop source the Latch stage reads, observed without holding any lock: the
    /// listener (the chord) and this engine's latch (api, fleet, host relay), then the durable
    /// stop marker another engine of the user may have committed, which is latched here so the
    /// stop sticks for the session's later calls (review L1 of #13767).
    fn stop_while_waiting(&mut self) -> Option<Refusal> {
        self.reconcile_stop();
        self.guard
            .latch_committed_marker()
            .map(SuspendReason::refusal)
    }
}
