//! Input transaction and concurrent background watch ownership.

use super::*;
use crate::restore::Guard;
use senpi_desktop_core::background_action::BackgroundActionScope;
use senpi_desktop_core::types::Target;

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
        let mut guard = match Guard::begin(self, mutation.action, mutation.delivery) {
            Ok(guard) => guard,
            Err(error) => return (Err(TransactionError::Primary(error)), None),
        };
        let mut background = if mutation.delivery == DeliveryMode::Background
            && !matches!(
                mutation.action,
                MutatingAction::RaiseWindow | MutatingAction::ClipboardWrite
            )
            && matches!(Target::parse(&mutation.target), Target::Window(_))
        {
            let audit = self.reroute_audit_sink(&mutation.target);
            match self.backend().and_then(|backend| {
                backend.begin_background_action(&Target::parse(&mutation.target), audit)
            }) {
                Ok(watch) => watch,
                Err(error) => return (Err(TransactionError::Primary(error)), None),
            }
        } else {
            None
        };
        let background_state = background.as_ref().map(|watch| watch.state());
        let _background_scope = background_state.clone().map(BackgroundActionScope::enter);
        let mut result = match self.stop_observed(cancelled) {
            Some(stopped) => Err(stopped),
            None => guarded(|| act(self)),
        };
        if result.is_ok() {
            result = self.after_action(mutation, result);
        }
        if let Some(watch) = &mut background {
            if let Err(cleanup) = guarded(|| watch.finish()) {
                match &mut result {
                    Ok(_) => result = Err(cleanup),
                    Err(primary) => {
                        primary.message = format!(
                            "{}; background focus cleanup also failed: {cleanup}",
                            primary.message
                        )
                    }
                }
            }
        }
        if result.is_ok() {
            if let Err(intervened) = senpi_desktop_core::background_action::check_press() {
                result = Err(intervened);
            }
        }
        if let Err(primary) = &mut result {
            // Recorded on the primary error, never in place of it.
            if let Err(release) = guarded(|| self.backend()?.release_all()) {
                primary.message = format!(
                    "{}; releasing held input also failed: {release}",
                    primary.message
                );
            }
        }
        if let Some(state) = background_state {
            guard.follow_background_lease(&state.lease.lock());
        }
        guard.restore(self, result)
    }
}
