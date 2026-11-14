//! The gate run again after time passed (the busy wait, another holder of the interaction lock).

use super::super::{Mutation, Refused};
use crate::grant::Plan;
use crate::Session;

impl Session {
    /// The four steps of a re-admission: the stop reconciled through the funnel, the stop epoch
    /// read fresh, the plan (consent, lease, reservations) made again, and the gate run on that
    /// plan's stages. Answers the fresh plan and epoch, or the refusal and its stage.
    pub(super) fn readmit(
        &mut self,
        mutation: &Mutation<'_>,
    ) -> Result<(Plan, u64), Box<(String, Refused)>> {
        self.reconcile_stop();
        let epoch = self.guard.supervisor().stop_epoch();
        let call = (mutation.method, &mutation.call.target, mutation.route);
        let plan = self.funnel.control.plan(self.backend.as_mut(), call, epoch);
        match self
            .guard
            .admit_on_with(self.backend.as_mut(), &mutation.call, plan.stages)
        {
            Ok(_) => Ok((plan, epoch)),
            Err(refused) => Err(Box::new((
                format!("{:?}", refused.gate),
                refused.refusal.into(),
            ))),
        }
    }
}
