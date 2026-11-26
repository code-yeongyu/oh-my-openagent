//! Row 21: the session's own Consent (gate 6) and Lease (gate 8) verdicts, handed to the gate
//! so the fixed gate order still decides which refusal wins; and the allowed denied apps.

use omo_computer_core::backend::{Backend, WindowFilter};

use super::{Call, Guard};
use crate::gate::verdicts::{ConsentRefusal, LeaseRefusal};
use crate::gate::{gate, Admitted, GateFacts, GateRefusal, Tables, Tier};
use crate::resolve::resolve;
use crate::supervisor::NoHolds;

/// The verdicts of the stages the session owns, handed to the gate so the fixed gate order
/// still decides which refusal wins.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StageVerdicts {
    pub consent: Option<ConsentRefusal>,
    pub lease: Option<LeaseRefusal>,
}

impl Guard {
    /// `consent.apps.allow`: denied apps the user allowed (the Target and Scope stages read it).
    pub fn set_allowed_apps(&mut self, apps: Vec<String>) {
        self.allowed_apps = apps;
    }

    /// [`Guard::admit_on`] with the session's stage verdicts.
    ///
    /// # Errors
    /// The first refusing gate, with nothing sent.
    pub fn admit_on_with(
        &mut self,
        backend: &mut dyn Backend,
        call: &Call<'_>,
        stages: StageVerdicts,
    ) -> Result<Admitted, GateRefusal> {
        self.observe(&mut || backend.stop_listener(), &mut NoHolds);
        self.refresh();
        let now = self.now_ms();
        let mut facts = GateFacts::clear(Tier::Exec, call.verb, self.supervisor.view(now));
        facts.latch = self.supervisor.latch();
        facts.screen_locked = backend.capabilities().session.screen_locked;
        facts.permission = backend.probe_permissions().input;
        facts.chord.clone_from(&call.chord);
        facts.force = call.force;
        facts.consent = stages.consent;
        facts.lease = stages.lease;
        let tables = Tables {
            self_set: &self.self_set,
            protected: self.table,
            allowed_apps: &self.allowed_apps,
        };
        gate(&facts, &tables, || {
            let windows = backend
                .windows(&WindowFilter::default())
                .ok()
                .map(|list| list.windows);
            resolve(windows.as_deref(), call.target, call.verb, &call.points)
        })
    }
}
