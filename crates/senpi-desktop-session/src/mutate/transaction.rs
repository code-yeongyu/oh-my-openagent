//! The transaction proper: the gate and admissions, the actionability wait
//! before the machine-wide lock, the capture, the dispatch under the lock,
//! and the restore.

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::report::ActionRoute;

use super::{route, Mutation};
use crate::lock::Held;
use crate::report::Stage;
use crate::restore::{Guard, TransactionError};
use crate::session::guarded;
use crate::timings::TimedStage;
use crate::worker::Worker;

/// A foreground transaction, and any transaction whose guard captures focus
/// to hand back (background keys: `Guard::KeyFocus`), holds the machine-wide
/// lock from its capture through its restore; other background exec holds it
/// only around its dispatch.
fn locks_whole_transaction(mutation: &Mutation<'_>) -> bool {
    mutation.delivery == DeliveryMode::Foreground
        || matches!(route(mutation), Some(ActionRoute::ForegroundHid))
        || Guard::captures(mutation.action, mutation.delivery)
}

impl Worker {
    /// The gate and the transaction proper; `focus_restored` is `None` when
    /// nothing was captured to restore.
    pub(crate) fn transaction<T>(
        &mut self,
        mutation: &Mutation<'_>,
        cancelled: &dyn Fn() -> bool,
        act: impl FnOnce(&mut Self) -> CoreResult<T>,
    ) -> (Result<T, TransactionError>, Option<bool>) {
        // The fail-closed gate (stop path, lock, permissions) answers first:
        // asking the human for a grant is pointless while input cannot run.
        if let Err(refused) = self.gate(mutation) {
            return (Err(TransactionError::Primary(refused)), None);
        }
        if let Err(refused) = self.admit_control(mutation) {
            return (Err(TransactionError::Primary(refused)), None);
        }
        let _watch = match self.admit_intervention(mutation, cancelled) {
            Ok(watch) => watch,
            Err(refused) => return (Err(TransactionError::Primary(refused)), None),
        };
        let actionable = match self.wait_until_actionable(mutation, cancelled) {
            Ok(bounds) => bounds,
            Err(refused) => return (Err(TransactionError::Primary(refused)), None),
        };
        let whole = locks_whole_transaction(mutation);
        // Dropped after the restore below: the tail expression runs first.
        let _interaction = match whole.then(|| self.take_interaction(mutation, cancelled)).transpose() {
            Ok(held) => held.flatten(),
            Err(refused) => return (Err(TransactionError::Primary(refused)), None),
        };
        let begun = mutation
            .timings
            .time(TimedStage::Capture, || Guard::begin(self, mutation.action, mutation.delivery));
        let guard = match begun {
            Ok(guard) => guard,
            Err(error) => return (Err(TransactionError::Primary(error)), None),
        };
        // A failed dispatch keeps its lock until the release below has run.
        let mut failed_dispatch = None;
        let mut result = match self.stop_observed(cancelled) {
            Some(stopped) => Err(stopped),
            None => match (!whole).then(|| self.take_interaction(mutation, cancelled)).transpose() {
                Err(refused) => Err(refused),
                Ok(dispatch) => {
                    mutation.stage.set(Stage::Acting);
                    let acted = mutation.timings.time(TimedStage::Dispatch, || guarded(|| {
                        self.assert_actionable_now(mutation, cancelled, actionable)?;
                        act(self)
                    }));
                    if acted.is_err() {
                        failed_dispatch = dispatch;
                    }
                    acted
                }
            },
        };
        if result.is_ok() {
            mutation.stage.set(Stage::Acted);
            result = mutation
                .timings
                .time(TimedStage::Verify, || self.after_action(mutation, result));
        }
        if let Err(primary) = &mut result {
            // Recorded on the primary error, never in place of it.
            if let Err(release) = guarded(|| self.backend()?.release_all()) {
                primary.message = format!("{}; releasing held input also failed: {release}", primary.message);
            }
        }
        drop(failed_dispatch);
        mutation.timings.time(TimedStage::Restore, || guard.restore(self, result))
    }

    /// Takes the slot's machine-wide lock, giving up on a stop, a
    /// cancellation, or another process holding it past the wait budget.
    fn take_interaction(&self, mutation: &Mutation<'_>, cancelled: &dyn Fn() -> bool) -> CoreResult<Option<Held>> {
        self.safety
            .control_slot
            .interaction()
            .acquire(mutation.fake_backend.get(), &|| self.stop_observed(cancelled))
    }
}
