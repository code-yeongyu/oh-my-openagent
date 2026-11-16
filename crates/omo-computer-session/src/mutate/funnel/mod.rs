//! `Session::mutate`: the stages in order. No OS call precedes the marker write, and no stage
//! retries.

use std::hash::{BuildHasher, Hasher};

use omo_computer_core::backend::{Delivered, Refusal};
use omo_computer_core::error::EngineCode;
use omo_computer_core::intervention::BackendClock;
use omo_computer_core::params::ReportMode;
use omo_computer_core::results::ExecReply;
use serde_json::json;

mod binding;
mod delivered;
mod readmit;
mod refusal;

use super::record::{target_id, Record};
use super::recovery::Verdict;
use super::report::{self, Sent};
use super::{Mutation, Refused, Stamps, MARKER_UNAVAILABLE, TRANSACTION_FAILED};
use crate::budget::PermitKind;
use crate::intervention::{Ended, MidSend, Stop};
use crate::session_state::sample;
use crate::{Session, NOT_OPEN};

/// Row 22's admission outcome and per-call settings, and row 21's audit binding, carried into
/// the send stages.
struct Held {
    admission: crate::intervention::Admission,
    policy: omo_computer_core::settings::Intervention,
    object: bool,
    hold_limits: crate::intervention::HoldLimits,
    target: Option<String>,
    binding: Option<(bool, Option<Vec<u8>>)>,
}

impl Session {
    /// Runs one mutating call through the funnel.
    ///
    /// # Errors
    /// The gate's, the marker's or the backend's refusal; nothing is sent on any refusal
    /// produced before the send.
    pub(crate) fn mutate(&mut self, mutation: Mutation<'_>) -> Result<ExecReply, Refused> {
        let (report_mode, tag, policy, ceiling) = {
            let opened = self.opened.as_ref().ok_or(NOT_OPEN)?;
            (
                opened.report_mode,
                opened.tag,
                opened.settings.policy,
                opened.settings.pause_ceiling_ms,
            )
        };
        let object = report_mode == ReportMode::Object;
        let hold_limits = self.hold_limits();
        self.funnel.audit().admit()?;
        let call_id = mutation.call_id.clone().unwrap_or_else(mint_call_id);
        let target = target_id(&mutation.call.target);
        let secure = self.funnel.secure.secure(self.backend.as_ref(), target);
        let record = Record::new(&self.funnel, &mutation, &call_id, secure);
        self.reconcile_stop();
        let mut epoch = self.guard.supervisor().stop_epoch();
        let call = (mutation.method, &mutation.call.target, mutation.route);
        let mut plan = self.funnel.control.plan(self.backend.as_mut(), call, epoch);
        let pausing = object.then_some(ceiling);
        let admission = match self.admit_call(&mutation.call, mutation.route, plan.stages, pausing) {
            Ok(admission) => admission,
            Err(blocked) => {
                let detail = match blocked.stage.as_str() {
                    "Consent" => plan.consent_detail.clone(),
                    "Lease" => plan.lease_detail.clone(),
                    _ => None,
                };
                let mut refused = self.stamp(*blocked.refused, object);
                refused.detail = detail.map(Box::new);
                return Err(self.refuse(record, Some(blocked.stage), refused));
            }
        };
        if let Some(frame) = mutation.frame_refusal {
            return Err(self.refuse(record, Some("Frame".to_owned()), frame.refusal().into()));
        }
        let waited_ms = match self.busy_before_send(target) {
            Ok(waited_ms) => waited_ms,
            Err(busy) => {
                let busy = self.stamp(busy, object);
                return Err(self.refuse(record, Some("Busy".to_owned()), busy));
            }
        };
        // The busy wait let time pass after the gate: a stop, a lock or a lost permission
        // during it must still refuse, so a wait that took time is admitted again before
        // anything is taken or sent. A target that was not busy keeps the single gate pass.
        if waited_ms > 0 {
            // R70s(1), the fold: a stop during the wait ends the lease through the funnel, the
            // epoch is read fresh, the plan (consent, lease, reservations) is made again, and the
            // gate admits the call again on that new plan before anything is taken or sent.
            match self.readmit(&mutation) {
                Ok(fresh) => (plan, epoch) = fresh,
                Err(refused) => {
                    let (stage, out) = *refused;
                    let out = self.stamp(out, object);
                    return Err(self.refuse(record, Some(stage), out));
                }
            }
        }
        if let Err((refusal, detail)) = self.funnel.control.commit(self.backend.as_mut(), &plan, epoch) {
            let out = Refused {
                detail: detail.map(Box::new),
                ..refusal.refusal().into()
            };
            return Err(self.refuse(record, Some("Lease".to_owned()), out));
        }
        let held = Held {
            admission,
            policy,
            object,
            hold_limits,
            target: target.map(str::to_owned),
            binding: plan.audit_binding.clone(),
        };
        let result = self.admitted(mutation, record, (call_id, report_mode, tag), held);
        self.funnel.control.reported(&plan);
        result
    }

    /// The stages after the gate admitted the call and its lease and reservations are taken.
    fn admitted(
        &mut self,
        mutation: Mutation<'_>,
        mut record: Record,
        (call_id, report_mode, tag): (String, omo_computer_core::params::ReportMode, u64),
        held: Held,
    ) -> Result<ExecReply, Refused> {
        let Held {
            admission,
            policy,
            object,
            hold_limits,
            target,
            binding,
        } = held;
        let target = target.as_deref();
        let identity_unavailable = binding::bind_audit(&mut record, binding.as_ref());
        // `&mut Session` serialises a session's calls, so no exec permit free means one leaked:
        // refused with nothing sent, never sent without one.
        let Some(_permit) = self.funnel.permits.try_take(PermitKind::Exec) else {
            return Err(self.refuse(record, Some("Permit".to_owned()), TRANSACTION_FAILED.into()));
        };
        match self.funnel.recover(&call_id) {
            Err(refused) => return Err(self.refuse(record, Some("Marker".to_owned()), refused)),
            Ok(Verdict::Refuse {
                refused,
                clear,
                warnings,
            }) => {
                record.event.warnings.extend(warnings);
                return Err(self.refuse_and_clear(record, refused, clear));
            }
            Ok(Verdict::Proceed) => {}
        }
        let lock = match self
            .funnel
            .lock
            .as_ref()
            .map(crate::lock::InteractionLock::acquire)
            .transpose()
        {
            Ok(lock) => lock,
            Err(error) => {
                self.funnel
                    .warn(format!("interaction lock not taken: {error}"));
                return Err(self.refuse(
                    record,
                    Some("Lock".to_owned()),
                    TRANSACTION_FAILED.into(),
                ));
            }
        };
        // Time passes between the first gate and here (the busy wait, another holder of the
        // interaction lock): on every path the gate runs again once the lock is held, and
        // nothing is SENT before it. (The exec permit and the marker recovery come earlier;
        // they send nothing.) A refusal drops the lock with nothing sent.
        // Row 21 on #13391's re-admit (R70bg(2)): the stop is reconciled through the funnel, the
        // epoch is read fresh and the gate runs on a fresh plan's stages, so a stop or a consent
        // change while another holder kept the lock refuses here too.
        if let Err(refused) = self.readmit(&mutation) {
            let (stage, out) = *refused;
            drop(lock);
            let out = self.stamp(out, object);
            return Err(self.refuse(record, Some(stage), out));
        }
        if object && crate::intervention::foreign_input_holds(self.backend.as_ref(), admission.pid) {
            drop(lock);
            let out = self.stamp(Refusal::bare(EngineCode::UserIntervened).into(), object);
            return Err(self.refuse(record, Some("Attribution".to_owned()), out));
        }
        if let Err(error) = self.funnel.markers.create(&record.marker) {
            self.funnel.warn(format!("marker not written: {error}"));
            return Err(self.refuse(record, Some("Marker".to_owned()), MARKER_UNAVAILABLE.into()));
        }
        let watch = admission
            .pid
            .and_then(|pid| MidSend::start(self.backend.as_ref(), pid, policy));
        let outcome = self.send_watched(mutation.events, mutation.route, tag, watch, target);
        drop(lock);
        let (count, of) = (outcome.count, outcome.of);
        if count > 0 {
            if let Some(now) = self.backend.clock().map(BackendClock::now_ms) {
                self.display_awake.update(|hold| hold.on_exec(now, hold_limits));
            }
        }
        if let Some((target, frame_id)) = mutation.consume.as_ref().filter(|_| count > 0) {
            self.frames.consume(target, frame_id);
        }
        // A null-mode call behaves as today until the cutover: it never waits to settle (R70ci).
        let settled = (object && outcome.stop.is_none() && count > 0)
            .then(|| self.settle_after_send(target))
            .flatten();
        let read_back = report::read_back(report::settle(settled.as_ref()));
        let paused = if object { admission.paused } else { Vec::new() };
        let session = object.then(|| sample(self.backend.as_ref()));
        match outcome.stop {
            Some(Stop::Refused(refusal)) if count == 0 => {
                let issuer = record.marker.binding.issuer.clone();
                let scope = record.marker.binding.scope.clone();
                if let Err(error) = self.funnel.markers.clear(&issuer, &scope) {
                    self.funnel
                        .warn(format!("marker not cleared after a refused send: {error}"));
                }
                let refused = Refused::from(refusal).with_paused(paused);
                let refused = self.stamp(refused, object);
                Err(self.refuse(record, None, refused))
            }
            Some(stop) => {
                let ended = Ended::of(stop, count);
                record.sent(count, of, ended.disposition, "unverifiable", Some(&ended.refusal));
                let stored = json!({ "error": { "code": ended.refusal.code.wire(), "reason": ended.refusal.reason } });
                self.store_receipt(&mut record, stored);
                let warning = self.append_or_warn(record.event);
                Err(Refused {
                    call_id: Some(call_id),
                    interrupted: ended.interrupted,
                    stamps: Box::new(Stamps {
                        delivered: object.then_some(Delivered { count, of }),
                        paused,
                        session,
                        target: ended.target,
                    }),
                    warning,
                    ..Refused::from(ended.refusal)
                })
            }
            None => {
                let sent = Sent {
                    route: mutation.route,
                    count,
                    of,
                    effect: read_back.effect,
                    user_moved_on: false,
                    warning: None,
                    settle: settled.as_ref().map(crate::settle::Settled::wire),
                    audit_id: None,
                    paused,
                    session,
                    target: None,
                };
                let reply = (report_mode, mutation.method);
                Ok(self.reply_delivered(record, reply, sent, identity_unavailable))
            }
        }
    }
}

fn mint_call_id() -> String {
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u32(std::process::id());
    format!("engine-{:016x}", hasher.finish())
}
