//! The funnel's refusal and receipt writers: every refusal writes its audit line before it answers.

use super::super::record::Record;
use super::super::Refused;
use crate::audit::AuditEvent;
use crate::marker::Receipt;
use crate::Session;

impl Session {
    pub(super) fn store_receipt(&mut self, record: &mut Record, reply: serde_json::Value) {
        record.marker.receipt = Some(Receipt { reply });
        if let Err(error) = self.funnel.markers.record_receipt(&record.marker) {
            self.funnel
                .warn(format!("marker receipt not stored: {error}"));
        }
    }

    /// Writes the refusal's audit line and answers it.
    pub(super) fn refuse(&mut self, record: Record, stage: Option<String>, refused: Refused) -> Refused {
        let mut record = record;
        record.refused(stage, &refused.refusal);
        let warning = self.append_or_warn(record.event);
        Refused { warning, ..refused }
    }

    /// Appends one audit line. A failure degrades the sink (every later admission refuses);
    /// it is logged and answers `write_failed`.
    pub(super) fn append_or_warn(&mut self, event: AuditEvent) -> Option<String> {
        let error = self.funnel.audit().append(event).err()?;
        self.funnel.warn(format!("audit line not written: {error}"));
        Some("write_failed".to_owned())
    }

    /// A marker refusal: its audit line, then (on a re-drive) the marker cleared by it.
    pub(super) fn refuse_and_clear(&mut self, record: Record, refused: Refused, clear: bool) -> Refused {
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
