//! The gate run again after time passed (the busy wait, another holder of the interaction lock).

use omo_computer_safety::{Gate, GateRefusal};

use super::super::{Mutation, Refused};
use crate::grant::Plan;
use crate::Session;

/// A gate refusal with the plan's wire members (review L3): the Consent stage carries the plan's
/// consent detail (`{app, identity}`), the Lease stage its lease detail (`{window, holder,
/// retryAfterMs}`); the first pass and every re-admit answer the same shape.
pub(super) fn gate_refused(refused: GateRefusal, plan: &Plan) -> (String, Refused) {
    let detail = match refused.gate {
        Gate::Consent => plan.consent_detail.clone(),
        Gate::Lease => plan.lease_detail.clone(),
        _ => None,
    };
    let out = Refused {
        detail: detail.map(Box::new),
        ..refused.refusal.into()
    };
    (format!("{:?}", refused.gate), out)
}

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
            Err(refused) => Err(Box::new(gate_refused(refused, &plan))),
        }
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_backend_fake::{fixtures_dir, FakeBackend, FakeScenario, StopPathScript};
    use omo_computer_core::backend::Route;
    use omo_computer_core::methods::Method;
    use omo_computer_core::requests::CallAuthority;
    use omo_computer_safety::{Call, TargetRef, VerbKind};

    use super::super::super::Mutation;
    use crate::Session;

    /// Review L3 at a07dff9 (R70cl): a refusal on a re-admit path carries the fresh plan's detail
    /// exactly as the first pass does: an identity_changed refusal names its app and both
    /// identities, never a bare code.
    #[test]
    fn a_readmit_refusal_carries_the_fresh_plans_consent_detail() {
        let scenario = FakeScenario::load(&fixtures_dir().join("v3-consent-identity-changed.json"))
            .expect("fixture");
        let backend = FakeBackend::new(scenario).with_stop_path(StopPathScript::Live);
        let mut s = Session::new(Box::new(backend));
        s.open(
            serde_json::from_value(serde_json::json!({ "reportMode": "null" })).expect("params"),
        )
        .expect("open");
        s.stop_path_start(serde_json::from_value(serde_json::json!({})).expect("params"));
        let call = Call {
            verb: VerbKind::Pointer,
            target: TargetRef::read(Some("101")),
            points: Vec::new(),
            chord: None,
            force: false,
        };
        let mutation = Mutation::exec(
            Method::Click,
            call,
            Vec::new(),
            Route::BackgroundWindow,
            &CallAuthority::default(),
        );
        let refused = s
            .readmit(&mutation)
            .expect_err("the stored identity differs from the observed one");
        let (stage, out) = *refused;
        assert_eq!(stage, "Consent");
        assert_eq!(out.refusal.reason, Some("identity_changed"));
        let detail = out.detail.expect("the fresh plan's consent detail");
        assert!(
            detail.get("app").is_some() && detail.get("identity").is_some(),
            "{detail}"
        );
    }
}
