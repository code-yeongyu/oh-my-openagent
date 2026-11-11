//! `Session::mutate` (RED stub: the row-15 path - gate, then send - with no marker, receipt or audit).

use omo_computer_core::backend::TaggedInput;
use omo_computer_core::results::ExecReply;

use super::{Mutation, Refused};
use crate::{Session, NOT_OPEN};

impl Session {
    /// # Errors
    /// The gate's or the backend's refusal.
    pub(crate) fn mutate(&mut self, mutation: Mutation<'_>) -> Result<ExecReply, Refused> {
        let tag = self.opened.as_ref().ok_or(NOT_OPEN)?.tag;
        self.guard
            .admit_on(self.backend.as_mut(), &mutation.call)
            .map_err(|refused| Refused::from(refused.refusal))?;
        for event in mutation.events {
            self.backend.post_input(&TaggedInput { event, tag }, mutation.route)?;
        }
        Ok(ExecReply(None))
    }
}
