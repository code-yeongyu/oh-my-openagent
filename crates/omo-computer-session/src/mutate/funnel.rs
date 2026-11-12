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
use crate::audit::AuditEvent;
use crate::budget::PermitKind;
use crate::marker::Receipt;
use crate::{Session, NOT_OPEN};

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
        let mut record = Record::new(&self.funnel, &mutation, &call_id, secure);
        if let Err(refused) = self.guard.admit_on(self.backend.as_mut(), &mutation.call) {
            return Err(self.refuse(
                record,
                Some(format!("{:?}", refused.gate)),
                refused.refusal.into(),
            ));
        }
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
                if let Err(error) = self.funnel.markers.clear(&issuer, &scope) {
                    self.funnel
                        .warn(format!("marker not cleared after a refused send: {error}"));
                }
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
                let warning = self.append_or_warn(record.event);
                Err(Refused {
                    refusal,
                    call_id: Some(call_id),
                    receipt: None,
                    interrupted: Some(Disposition::UNCERTAIN_UNSAFE),
                    warning,
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
            self.funnel
                .warn(format!("marker receipt not stored: {error}"));
        }
    }

    /// Writes the refusal's audit line and answers it.
    fn refuse(&mut self, record: Record, stage: Option<String>, refused: Refused) -> Refused {
        let mut record = record;
        record.refused(stage, &refused.refusal);
        let warning = self.append_or_warn(record.event);
        Refused { warning, ..refused }
    }

    /// Appends one audit line. A failure degrades the sink (every later admission refuses);
    /// it is logged and answers `write_failed`.
    fn append_or_warn(&mut self, event: AuditEvent) -> Option<String> {
        let error = self.funnel.audit().append(event).err()?;
        self.funnel.warn(format!("audit line not written: {error}"));
        Some("write_failed".to_owned())
    }

    /// A marker refusal: its audit line, then (on a re-drive) the marker cleared by it.
    fn refuse_and_clear(&mut self, record: Record, refused: Refused, clear: bool) -> Refused {
        let mut record = record;
        record.refused(Some("Marker".to_owned()), &refused.refusal);
        if let Some(interrupted) = refused.interrupted {
            record.sent(0, 0, interrupted, "unverifiable", None);
            record.event.delivered = None;
        }
        let warning = self.append_or_warn(record.event);
        if clear && warning.is_none() {
            let binding = self.funnel.binding.clone();
            if let Err(error) = self.funnel.markers.clear(&binding.issuer, &binding.scope) {
                self.funnel
                    .warn(format!("recovered marker not cleared: {error}"));
            }
        }
        Refused { warning, ..refused }
    }
}

fn mint_call_id() -> String {
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u32(std::process::id());
    format!("engine-{:016x}", hasher.finish())
}
