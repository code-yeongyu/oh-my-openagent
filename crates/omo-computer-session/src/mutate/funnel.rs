//! `Session::mutate`: the stages in order. No OS call precedes the marker write, and no stage
//! retries.

use std::hash::{BuildHasher, Hasher};

use omo_computer_core::backend::{Refusal, TaggedInput};
use omo_computer_core::report::Disposition;
use omo_computer_core::results::ExecReply;
use serde_json::json;

use super::record::{target_id, Record};
use super::recovery::Verdict;
use super::report::{self, Sent};
use super::{Mutation, Refused, MARKER_UNAVAILABLE, TRANSACTION_FAILED};
use crate::budget::PermitKind;
use crate::marker::Receipt;
use crate::{Session, NOT_OPEN};
use omo_computer_safety::Gate;

impl Session {
    /// Runs one mutating call through the funnel.
    ///
    /// # Errors
    /// The gate's, the marker's or the backend's refusal; nothing is sent on any refusal
    /// produced before the send.
    pub(crate) fn mutate(&mut self, mutation: Mutation<'_>) -> Result<ExecReply, Refused> {
        let (report_mode, tag) = {
            let opened = self.opened.as_ref().ok_or(NOT_OPEN)?;
            (opened.report_mode, opened.tag)
        };
        self.funnel.audit().admit()?;
        let call_id = mutation.call_id.clone().unwrap_or_else(mint_call_id);
        let target = target_id(&mutation.call.target);
        let secure = self.funnel.secure.secure(self.backend.as_ref(), target);
        let record = Record::new(&self.funnel, &mutation, &call_id, secure);
        let epoch = self.guard.supervisor().stop_epoch();
        let call = (mutation.method, &mutation.call.target, mutation.route);
        let mut plan = self.funnel.control.plan(self.backend.as_mut(), call, epoch);
        let url = super::url::check(&self.funnel.url_policy, self.backend.as_mut(), &mutation.call.target);
        plan.stages.consequential = url.refusal;
        plan.stages.targets = mutation.targets.clone();
        self.funnel.url_unknown = url.unknown;
        if let Err(refused) =
            self.guard
                .admit_on_with(self.backend.as_mut(), &mutation.call, plan.stages.clone())
        {
            let detail = match refused.gate {
                Gate::Consent => plan.consent_detail.clone(),
                Gate::Lease => plan.lease_detail.clone(),
                Gate::Consequential => url.detail.clone(),
                _ => None,
            };
            let out = Refused {
                detail: detail.map(Box::new),
                ..refused.refusal.into()
            };
            return Err(self.refuse(record, Some(format!("{:?}", refused.gate)), out));
        }
        if let Err((refusal, detail)) = self.funnel.control.commit(self.backend.as_mut(), &plan, epoch) {
            let out = Refused {
                detail: detail.map(Box::new),
                ..refusal.refusal().into()
            };
            return Err(self.refuse(record, Some("Lease".to_owned()), out));
        }
        let result = self.admitted(mutation, record, (call_id, report_mode, tag));
        self.funnel.control.reported(&plan);
        result
    }

    /// The stages after the gate admitted the call and its lease and reservations are taken.
    fn admitted(
        &mut self,
        mutation: Mutation<'_>,
        mut record: Record,
        (call_id, report_mode, tag): (String, omo_computer_core::params::ReportMode, u64),
    ) -> Result<ExecReply, Refused> {
        let _permit = self.funnel.permits.try_take(PermitKind::Exec);
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
            Err(_) => {
                return Err(self.refuse(record, Some("Lock".to_owned()), TRANSACTION_FAILED.into()))
            }
        };
        if self.funnel.markers.create(&record.marker).is_err() {
            return Err(self.refuse(record, Some("Marker".to_owned()), MARKER_UNAVAILABLE.into()));
        }
        let of = u32::try_from(mutation.events.len()).unwrap_or(u32::MAX);
        let (count, failure) = self.send(mutation.events, mutation.route, tag);
        drop(lock);
        let read_back = report::read_back(report::settle());
        match failure {
            Some(refusal) if count == 0 => {
                let issuer = record.marker.binding.issuer.clone();
                let scope = record.marker.binding.scope.clone();
                let _ = self.funnel.markers.clear(&issuer, &scope);
                Err(self.refuse(record, None, refusal.into()))
            }
            Some(refusal) => {
                record.sent(
                    count,
                    of,
                    Disposition::UNCERTAIN_UNSAFE,
                    "unverifiable",
                    Some(&refusal),
                );
                let stored =
                    json!({ "error": { "code": refusal.code.wire(), "reason": refusal.reason } });
                self.store_receipt(&mut record, stored);
                let _ = self.funnel.audit().append(record.event);
                Err(Refused {
                    refusal,
                    call_id: Some(call_id),
                    receipt: None,
                    interrupted: Some(Disposition::UNCERTAIN_UNSAFE),
                    detail: None,
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
                let sent = Sent {
                    route: mutation.route,
                    count,
                    of,
                    effect: read_back.effect,
                    user_moved_on: self.funnel.control.presence.take_ended().is_some(),
                    url_unknown: std::mem::take(&mut self.funnel.url_unknown),
                    warning: appended.is_err().then(|| "write_failed".to_owned()),
                    audit_id: appended.ok(),
                };
                let reply =
                    report::reply(report_mode, mutation.method, sent).unwrap_or_else(|rejection| {
                        eprintln!("omo-computer-engine: action report rejected: {rejection:?}");
                        ExecReply(None)
                    });
                self.store_receipt(
                    &mut record,
                    serde_json::to_value(&reply).unwrap_or_default(),
                );
                Ok(reply)
            }
        }
    }

    /// The one side-effect sink: every event in order, stopping at the first refusal.
    fn send(
        &mut self,
        events: Vec<omo_computer_core::backend::InputEvent>,
        route: omo_computer_core::backend::Route,
        tag: u64,
    ) -> (u32, Option<Refusal>) {
        let mut count = 0;
        for event in events {
            match self.backend.post_input(&TaggedInput { event, tag }, route) {
                Ok(_) => count += 1,
                Err(refusal) => return (count, Some(refusal)),
            }
        }
        (count, None)
    }

    fn store_receipt(&mut self, record: &mut Record, reply: serde_json::Value) {
        record.marker.receipt = Some(Receipt { reply });
        if let Err(error) = self.funnel.markers.record_receipt(&record.marker) {
            eprintln!("omo-computer-engine: warn marker receipt not stored: {error}");
        }
    }

    /// Writes the refusal's audit line and answers it.
    fn refuse(&mut self, record: Record, stage: Option<String>, refused: Refused) -> Refused {
        let mut record = record;
        record.refused(stage, &refused.refusal);
        let _ = self.funnel.audit().append(record.event);
        refused
    }

    /// A marker refusal: its audit line, then (on a re-drive) the marker cleared by it.
    fn refuse_and_clear(&mut self, record: Record, refused: Refused, clear: bool) -> Refused {
        let mut record = record;
        record.refused(Some("Marker".to_owned()), &refused.refusal);
        if let Some(interrupted) = refused.interrupted {
            record.sent(0, 0, interrupted, "unverifiable", None);
            record.event.delivered = None;
        }
        let written = self.funnel.audit().append(record.event).is_ok();
        if clear && written {
            let binding = self.funnel.binding.clone();
            if let Err(error) = self.funnel.markers.clear(&binding.issuer, &binding.scope) {
                eprintln!("omo-computer-engine: warn recovered marker not cleared: {error}");
            }
        }
        refused
    }
}

fn mint_call_id() -> String {
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u32(std::process::id());
    format!("engine-{:016x}", hasher.finish())
}
