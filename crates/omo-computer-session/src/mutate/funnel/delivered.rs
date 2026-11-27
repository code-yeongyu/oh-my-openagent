//! The funnel's delivered reply: the audit line of a send that went out, the report built from it,
//! and the stored receipt (moved from funnel/mod.rs, R65: no change).

use omo_computer_core::methods::Method;
use omo_computer_core::params::ReportMode;
use omo_computer_core::report::Disposition;
use omo_computer_core::results::ExecReply;

use super::super::record::Record;
use super::super::report::{self, Sent};
use crate::Session;

impl Session {
    /// Writes a delivered send's audit line, then answers its report and stores the receipt.
    pub(super) fn reply_delivered(
        &mut self,
        mut record: Record,
        (report_mode, method): (ReportMode, Method),
        mut sent: Sent,
        identity_unavailable: bool,
    ) -> ExecReply {
        record.sent(
            sent.count,
            sent.of,
            Disposition::DELIVERED_UNVERIFIED,
            "unverifiable",
            None,
        );
        let appended = self.funnel.audit().append(record.event.clone());
        if let Err(error) = &appended {
            self.funnel.warn(format!("audit line not written: {error}"));
        }
        sent.user_moved_on = self.funnel.control.presence.take_ended().is_some();
        // A lost audit line outranks the binding note: one warning slot, integrity first.
        sent.warning = appended.is_err().then(|| "write_failed".to_owned()).or_else(|| {
            identity_unavailable.then(|| crate::consent::IDENTITY_UNAVAILABLE.to_owned())
        });
        sent.audit_id = appended.ok();
        let reply = report::reply(report_mode, method, sent).unwrap_or_else(|rejection| {
            eprintln!("omo-computer-engine: action report rejected: {rejection:?}");
            ExecReply(None)
        });
        let receipt = self.funnel.receipt_of(&reply);
        self.store_receipt(&mut record, receipt);
        reply
    }
}
