//! `Session::mutate`: the stages in order. No OS call precedes the marker write, and no stage
//! retries.

use std::hash::{BuildHasher, Hasher};

use omo_computer_core::backend::Delivered;
use omo_computer_core::params::ReportMode;
use omo_computer_core::report::Disposition;
use omo_computer_core::results::ExecReply;
use serde_json::json;

use super::record::{target_id, Record};
use super::recovery::Verdict;
use super::report::{self, Sent};
use super::{Mutation, Refused, Stamps, MARKER_UNAVAILABLE, TRANSACTION_FAILED};
use crate::budget::PermitKind;
use crate::intervention::{Ended, MidSend, Stop};
use omo_computer_core::intervention::BackendClock;
use crate::session_state::sample;

mod refusal;
use crate::{Session, NOT_OPEN};

/// Row 22's admission outcome and per-call settings, carried into the send stages.
struct Held {
    admission: crate::intervention::Admission,
    policy: omo_computer_core::settings::Intervention,
    object: bool,
    hold_limits: crate::intervention::HoldLimits,
    target: Option<String>,
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
        let epoch = self.guard.supervisor().stop_epoch();
        let call = (mutation.method, &mutation.call.target, mutation.route);
        let plan = self.funnel.control.plan(self.backend.as_mut(), call, epoch);
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
                if let Some(detail) = detail {
                    refused.detail = Some(Box::new(detail));
                }
                return Err(self.refuse(record, Some(blocked.stage), refused));
            }
        };
        if let Some(frame) = mutation.frame_refusal {
            return Err(self.refuse(record, Some("Frame".to_owned()), frame.refusal().into()));
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
        } = held;
        let target = target.as_deref();
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
        if let Err(error) = self.funnel.markers.create(&record.marker) {
            self.funnel.warn(format!("marker not written: {error}"));
            return Err(self.refuse(record, Some("Marker".to_owned()), MARKER_UNAVAILABLE.into()));
        }
        let watch = admission
            .pid
            .and_then(|pid| MidSend::start(self.backend.as_ref(), pid, policy));
        let (outcome, read_back) = match mutation.write.clone() {
            Some(write) => self.send_write(&write),
            None => (self.send_watched(mutation.events, mutation.route, tag, watch, target), None),
        };
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
        let settled = report::read_back(report::settle());
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
                record.sent(
                    count,
                    of,
                    Disposition::DELIVERED_UNVERIFIED,
                    "unverifiable",
                    None,
                );
                let appended = self.funnel.audit().append(record.event.clone());
                if let Err(error) = &appended {
                    self.funnel.warn(format!("audit line not written: {error}"));
                }
                let sent = Sent {
                    route: mutation.route,
                    count,
                    of,
                    // A route that delivered fewer units than were asked reports it (R48c).
                    effect: if count < of { omo_computer_core::report::Effect::Partial } else { read_back.as_ref().map_or(settled.effect, |r| r.effect) },
                    user_moved_on: self.funnel.control.presence.take_ended().is_some(),
                    warning: appended.is_err().then(|| "write_failed".to_owned()),
                    audit_id: appended.ok(),
                    paused,
                    session,
                    target: None,
                    read_back,
                };
                let reply =
                    report::reply(report_mode, mutation.method, sent).unwrap_or_else(|rejection| {
                        eprintln!("omo-computer-engine: action report rejected: {rejection:?}");
                        ExecReply(None)
                    });
                let receipt = self.funnel.receipt_of(&reply);
                self.store_receipt(&mut record, receipt);
                Ok(reply)
            }
        }
    }

}

fn mint_call_id() -> String {
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u32(std::process::id());
    format!("engine-{:016x}", hasher.finish())
}
