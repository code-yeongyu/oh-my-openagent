//! The last pass before delivery, under the interaction lock: the gate again, the attribution
//! hold, and in object mode the takeover hold (review M2 of #13355).
//!
//! Review H1/M1/L1/L2 of #13355 at b3227b53b2: a takeover wait is taken with the lock released,
//! under what is left of the call's pause ceiling, and every wait starts the pass over from the
//! lock. So nothing is sent on a gate pass or an attribution check older than the last wait: a
//! stop pressed during it refuses `Suspended`, and an input the user made right before switching
//! away holds the send.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::EngineCode;

use super::super::{Mutation, Refused, TRANSACTION_FAILED};
use crate::intervention::{foreign_input_holds, Admission};
use crate::lock::LockGuard;
use crate::Session;

/// Why the last pass refused: the audit stage and the refusal, nothing sent.
pub(super) type PassRefused = Box<(String, Refused)>;

impl Session {
    /// Takes the interaction lock and runs the last pass; answers the lock to send under.
    /// `pausing` is the call's pause ceiling in object mode.
    ///
    /// # Errors
    /// The first refusing stage (`Lock`, a gate stage, `Attribution` or `Pause`), with the lock
    /// released and nothing sent.
    pub(super) fn last_pass(
        &mut self,
        mutation: &Mutation<'_>,
        admission: &mut Admission,
        pausing: Option<u64>,
        object: bool,
    ) -> Result<Option<LockGuard>, PassRefused> {
        let mut may_pause = pausing.is_some();
        loop {
            let lock = self.interaction_lock().map_err(|error| {
                self.funnel
                    .warn(format!("interaction lock not taken: {error}"));
                let out = Refused::from(TRANSACTION_FAILED).with_paused(admission.paused.clone());
                Box::new(("Lock".to_owned(), out))
            })?;
            // Row 21 on #13391's re-admit (R70bg(2)): the stop is reconciled through the funnel,
            // the epoch is read fresh and the gate runs on a fresh plan's stages.
            // Every refusal here carries what the call already waited for (review L3 at
            // 749dc9d54c): a refusal after a takeover wait reports that wait.
            if let Err(refused) = self.readmit(mutation) {
                let (stage, out) = *refused;
                let out = out.with_paused(admission.paused.clone());
                return Err(Box::new((stage, self.stamp(out, object))));
            }
            // R70s(5): a foreign input inside the attribution window just before the send holds it.
            if object && foreign_input_holds(self.backend.as_ref(), admission.pid) {
                let out = Refused::from(Refusal::bare(EngineCode::UserIntervened))
                    .with_paused(admission.paused.clone());
                return Err(Box::new(("Attribution".to_owned(), self.stamp(out, object))));
            }
            let Some(ceiling_ms) = pausing.filter(|_| may_pause) else {
                return Ok(lock);
            };
            if self.hold_reason(admission.pid).is_none() {
                return Ok(lock);
            }
            drop(lock);
            match self.recheck_takeover(admission, ceiling_ms) {
                // A wait that took no time keeps the takeover check on the next pass (review L4
                // at 749dc9d54c: the hold that flickered off may be back once the lock is taken
                // again). A latched stop ends there: the next pass's gate answers `Suspended`.
                // Only a backend with no clock, which cannot wait at all, runs the next pass
                // without pausing, so the gate answers its hold (as `admit_call` does).
                Ok(waited) => may_pause = waited || self.backend.clock().is_some(),
                Err(out) => return Err(Box::new(("Pause".to_owned(), self.stamp(out, object)))),
            }
        }
    }
}
