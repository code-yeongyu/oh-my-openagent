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
use crate::session_state::sample;
use crate::marker::Receipt;
use crate::{Session, NOT_OPEN};

impl Session {
    /// Runs one mutating call through the funnel.
    ///
    /// # Errors
    /// The gate's, the marker's or the backend's refusal; nothing is sent on any refusal
    /// produced before the send.
    pub(crate) fn mutate(&mut self, mutation: Mutation<'_>) -> Result<ExecReply, Refused> {
        let (report_mode, tag, policy, ceiling) = {
            let opened = self.opened.as_ref().ok_or(NOT_OPEN)?;
            (opened.report_mode, opened.tag, opened.intervention, opened.pause_ceiling_ms)
        };
        let object = report_mode == ReportMode::Object;
        self.funnel.audit().admit()?;
        let call_id = mutation.call_id.clone().unwrap_or_else(mint_call_id);
        let target = target_id(&mutation.call.target);
        let secure = self.funnel.secure.secure(self.backend.as_ref(), target);
        let mut record = Record::new(&self.funnel, &mutation, &call_id, secure);
        let pausing = object.then_some(ceiling);
        let admission = match self.admit_call(&mutation.call, mutation.route, pausing) {
            Ok(admission) => admission,
            Err(blocked) => {
                let refused = self.stamp(blocked.refused, object);
                return Err(self.refuse(record, Some(blocked.stage), refused));
            }
        };
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
        let watch = admission
            .pid
            .and_then(|pid| MidSend::start(self.backend.as_ref(), pid, policy));
        let outcome = self.send_watched(mutation.events, mutation.route, tag, watch, target);
        drop(lock);
        let read_back = report::read_back(report::settle());
        let (count, of) = (outcome.count, outcome.of);
        let paused = if object { admission.paused } else { Vec::new() };
        let session = object.then(|| sample(self.backend.as_ref()));
        match outcome.stop {
            Some(Stop::Refused(refusal)) if count == 0 => {
                let issuer = record.marker.binding.issuer.clone();
                let scope = record.marker.binding.scope.clone();
                let _ = self.funnel.markers.clear(&issuer, &scope);
                let refused = Refused::from(refusal).with_paused(paused);
                let refused = self.stamp(refused, object);
                Err(self.refuse(record, None, refused))
            }
            Some(stop) => {
                let ended = Ended::of(stop, count);
                record.sent(count, of, ended.disposition, "unverifiable", Some(&ended.refusal));
                let stored = json!({ "error": { "code": ended.refusal.code.wire(), "reason": ended.refusal.reason } });
                self.store_receipt(&mut record, stored);
                let _ = self.funnel.audit().append(record.event);
                Err(Refused {
                    call_id: Some(call_id),
                    interrupted: ended.interrupted,
                    stamps: Box::new(Stamps {
                        delivered: object.then_some(Delivered { count, of }),
                        paused,
                        session,
                        target: ended.target,
                    }),
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
                let sent = Sent {
                    route: mutation.route,
                    count,
                    of,
                    effect: read_back.effect,
                    warning: appended.is_err().then(|| "write_failed".to_owned()),
                    audit_id: appended.ok(),
                    paused,
                    session,
                    target: None,
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
