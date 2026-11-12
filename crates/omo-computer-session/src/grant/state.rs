//! The row-21 state of one session: its consent, foreground grant, the machine's control slot,
//! window reservations, presence and preview; and the plan the funnel runs for one call.

use std::path::PathBuf;
use std::sync::Arc;

use omo_computer_core::backend::{Backend, Route};
use omo_computer_core::methods::Method;
use omo_computer_safety::gate::verdicts::{ConsentRefusal, LeaseRefusal};
use omo_computer_safety::guard::StageVerdicts;
use omo_computer_safety::TargetRef;
use serde_json::{json, Value};

use super::{is_global_target, ForegroundGrant, LeaseHook, NoLeaseHook};
use crate::consent::{AppTarget, BoundIdentity, Consent, Part};
use crate::lease::{ControlSlot, Holder, SessionToken};
use crate::presence::PresenceState;
use crate::preview::Preview;
use crate::reservation::Reservations;

/// A millisecond clock every session of the machine reads alike (reservations compare across
/// sessions); tests install a scripted one.
pub type MachineClock = Arc<dyn Fn() -> u64 + Send + Sync>;

#[must_use]
pub fn wall_clock() -> MachineClock {
    Arc::new(crate::audit::now_ms)
}

pub struct Control {
    pub(crate) consent: Consent,
    pub(crate) grant: ForegroundGrant,
    pub(crate) slot: ControlSlot,
    pub(crate) token: SessionToken,
    pub(crate) reservations: Reservations,
    pub(crate) presence: PresenceState,
    pub(crate) preview: Preview,
    pub(crate) runtime: Option<PathBuf>,
    pub(crate) display_released: bool,
    pub(crate) lease_epoch: Option<u64>,
    pub(crate) clock: MachineClock,
    pub(crate) lease_hook: Box<dyn LeaseHook>,
    /// Row 23's held-input ledger: holds need the foreground lease, and every lease end releases them.
    pub(crate) holds: crate::holds::SharedLedger,
}

impl Default for Control {
    fn default() -> Self {
        Self {
            consent: Consent::default(),
            grant: ForegroundGrant::default(),
            slot: ControlSlot::default(),
            token: SessionToken::in_memory(Holder {
                session_id: String::new(),
                agent: String::new(),
            }),
            reservations: Reservations::default(),
            presence: PresenceState::default(),
            preview: Preview::default(),
            runtime: None,
            display_released: false,
            lease_epoch: None,
            clock: wall_clock(),
            lease_hook: Box::new(NoLeaseHook),
            holds: crate::holds::SharedLedger::default(),
        }
    }
}

/// What the Consent and Lease stages decided for one call, with the wire members of a refusal.
#[derive(Debug, Default)]
pub struct Plan {
    pub stages: StageVerdicts,
    pub consent_detail: Option<Value>,
    pub lease_detail: Option<Value>,
    /// The call needs the foreground lease.
    pub foreground: bool,
    /// The windows the call reserves.
    pub windows: Vec<String>,
    /// The app entry has no readable identity: the reason rides the report.
    pub identity_unavailable: bool,
}

impl Control {
    pub(crate) fn now_ms(&self) -> u64 {
        (self.clock)()
    }

    /// The Consent (6) and Lease (8) verdicts of one call; nothing is taken yet.
    pub(crate) fn plan(
        &mut self,
        backend: &mut dyn Backend,
        call: (Method, &TargetRef<'_>, Route),
        stop_epoch: u64,
    ) -> Plan {
        let (method, target, route) = call;
        let mut plan = Plan::default();
        let windows = backend
            .windows(&omo_computer_core::backend::WindowFilter::default())
            .map(|list| list.windows)
            .unwrap_or_default();
        let (target_str, app) = match target {
            TargetRef::Desktop => (Some("desktop"), None),
            TargetRef::Window(id) => {
                let app = windows.iter().find(|w| w.id == *id).map(|w| AppTarget {
                    app_key: w.app_key.clone(),
                    bound: BoundIdentity::new(None, backend.code_identity(w.identity.pid)),
                });
                (Some(*id), app)
            }
        };
        match self.consent.admit_exec(app.as_ref()) {
            Ok(admission) => {
                plan.identity_unavailable = app.is_some()
                    && admission.binding == Some(crate::consent::Binding::PathOnly);
            }
            Err(denial) => {
                plan.stages.consent = Some(denial.refusal);
                plan.consent_detail = denial.detail;
            }
        }
        // `design/d-safety.md` '### Full access': input lands globally only for the eight
        // desktop / display-target methods (`posts_globally`, by where input lands); any other
        // method aimed at no window reserves nothing and needs no lease unless sent foreground.
        let global = super::GLOBAL_INPUT.contains(&method)
            && (matches!(target, TargetRef::Desktop) || is_global_target(target_str));
        plan.foreground = route == Route::ForegroundHid || global;
        plan.windows = match target {
            TargetRef::Window(id) if !is_global_target(Some(id)) => vec![(*id).to_owned()],
            _ if global => windows.iter().map(|w| w.id.clone()).collect(),
            _ => Vec::new(),
        };
        self.grant.reconcile(stop_epoch);
        if self.lease_epoch.is_some_and(|epoch| epoch != stop_epoch) {
            self.presence.end(crate::presence::LeaseEnd::Stop);
            self.slot.release(&self.token);
            self.lease_epoch = None;
        }
        let lease = if plan.foreground {
            self.lease_verdict(backend, (method, target_str))
        } else {
            Ok(())
        };
        let now = self.now_ms();
        let lease = lease.and_then(|()| {
            self.reservations
                .check(&self.token, &plan.windows, now)
                .map_err(|busy| (LeaseRefusal::Window, Some(busy.detail())))
        });
        match lease {
            Err((LeaseRefusal::Grant, _)) if self.consent.is_denied(Part::Foreground, None) => {
                plan.stages.consent.get_or_insert(ConsentRefusal::DeniedThisTurn);
            }
            Err((refusal, detail)) => {
                plan.stages.lease = Some(refusal);
                plan.lease_detail = detail;
            }
            Ok(()) => {}
        }
        plan
    }

    fn lease_verdict(
        &self,
        backend: &mut dyn Backend,
        call: (Method, Option<&str>),
    ) -> Result<(), (LeaseRefusal, Option<Value>)> {
        let view = self.consent.view();
        self.grant
            .admit(view, call, self.consent.hand())
            .map_err(|refusal| (refusal, None))?;
        if self.slot.is_mine(&self.token) {
            return Ok(());
        }
        if let Some(holder) = self.slot.holder(&self.token) {
            return Err((LeaseRefusal::InputBusy, Some(holder_detail(&holder))));
        }
        if backend.presence().is_none() {
            return Err((LeaseRefusal::NoPresenceSurface, None));
        }
        Ok(())
    }

    /// The gate admitted the call: take the lease (showing presence) and the reservations.
    ///
    /// # Errors
    /// Another session took the slot or a window between the plan and now.
    pub(crate) fn commit(
        &mut self,
        backend: &mut dyn Backend,
        plan: &Plan,
        stop_epoch: u64,
    ) -> Result<(), (LeaseRefusal, Option<Value>)> {
        if plan.foreground && !self.slot.is_mine(&self.token) {
            self.slot
                .acquire(&self.token)
                .map_err(|holder| (LeaseRefusal::InputBusy, Some(holder_detail(&holder))))?;
            if let Err(refusal) = self.presence.begin(backend) {
                self.slot.release(&self.token);
                return Err((refusal, None));
            }
            self.lease_epoch = Some(stop_epoch);
        }
        let now = self.now_ms();
        self.reservations
            .admit(&self.token, &plan.windows, now)
            .map_err(|busy| (LeaseRefusal::Window, Some(busy.detail())))
    }

    /// The call's report went out.
    pub(crate) fn reported(&mut self, plan: &Plan) {
        let now = self.now_ms();
        self.reservations.report(&self.token, &plan.windows, now);
    }
}

pub(crate) fn holder_detail(holder: &Holder) -> Value {
    json!({ "holder": { "sessionId": holder.session_id, "agent": holder.agent } })
}
