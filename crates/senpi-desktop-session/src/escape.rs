//! Escape arming follows the takeover transaction, not automatic consent's
//! lifetime. Explicit held control is the sole between-operation owner.

use std::sync::Arc;

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, ErrorCode, TccPermission};
use senpi_desktop_core::escape::EscapeOperation;

use crate::mutate::Mutation;
use crate::worker::Worker;

impl Worker {
    pub(crate) fn prepare_escape(&mut self) -> CoreResult<()> {
        self.watch_user_input();
        let stop = Arc::clone(&self.escape);
        self.backend()?.watch_escape(stop)?;
        Ok(())
    }

    pub(crate) fn arm_escape_operation(
        &mut self,
        mutation: &Mutation<'_>,
    ) -> CoreResult<Option<EscapeOperation>> {
        let held = self.control.as_ref().is_some_and(|grant| !grant.automatic);
        let takeover = mutation.delivery == DeliveryMode::Foreground
            || mutation.takes_over
            || crate::grant::posts_globally(mutation);
        if !held && !takeover {
            return Ok(None);
        }
        // Input keeps the existing stop-path refusal before probing a backend
        // that may be unavailable. Acquiring a grant alone is not input.
        if let Some(refused) = crate::mutate::interruption(&self.safety.supervisor, &self.stop_policy()) {
            self.release_control();
            return Err(if refused.code == ErrorCode::PermissionDenied {
                self.backend()?.permission_denied(TccPermission::Accessibility)
            } else {
                refused
            });
        }
        if let Err(error) = self.prepare_escape() {
            self.release_control();
            return Err(error);
        }
        if held {
            return Ok(None);
        }
        self.escape.arm();
        Ok(Some(EscapeOperation(Arc::clone(&self.escape))))
    }
}

#[cfg(test)]
mod tests;
