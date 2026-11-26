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
                Box::new(("Lock".to_owned(), Refused::from(TRANSACTION_FAILED)))
            })?;
            // Row 21 on #13391's re-admit (R70bg(2)): the stop is reconciled through the funnel,
            // the epoch is read fresh and the gate runs on a fresh plan's stages.
            if let Err(refused) = self.readmit(mutation) {
                let (stage, out) = *refused;
                return Err(Box::new((stage, self.stamp(out, object))));
            }
            // R70s(5): a foreign input inside the attribution window just before the send holds it.
            if object && foreign_input_holds(self.backend.as_ref(), admission.pid) {
                let out = self.stamp(Refusal::bare(EngineCode::UserIntervened).into(), object);
                return Err(Box::new(("Attribution".to_owned(), out)));
            }
            let Some(ceiling_ms) = pausing.filter(|_| may_pause) else {
                return Ok(lock);
            };
            if self.hold_reason(admission.pid).is_none() {
                return Ok(lock);
            }
            drop(lock);
            match self.recheck_takeover(admission, ceiling_ms) {
                // A wait that took no time (a latched stop, a lock with no clock) runs the pass
                // once more without pausing, so the gate answers it.
                Ok(waited) => may_pause = waited,
                Err(out) => return Err(Box::new(("Pause".to_owned(), self.stamp(out, object)))),
            }
        }
    }
}
