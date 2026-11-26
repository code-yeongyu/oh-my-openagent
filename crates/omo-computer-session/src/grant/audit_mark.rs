//! The audit-derived tampered mark (A-IS-62 R7-2): the hand's audit is read at engine start, at
//! session open and before every exec admission once the interaction lock is held; when it reads
//! tampered (a chord refusal any process wrote, or a file that fails R7-4), this process holds the
//! hand tampered as row 21's in-process mark does, and never clears it.

use crate::Session;

impl Session {
    /// Reads the hand's audit and, when it reads tampered, holds the hand tampered.
    pub(crate) fn read_audit_mark(&mut self) {
        let Some(tamper) = self.funnel.audit().read_mark() else {
            return;
        };
        if !self.funnel.control.chord_tamper.holds(None) {
            self.funnel.warn(format!(
                "the hand's audit reads tampered ({tamper:?}): exec is refused with nothing sent and reads continue; nothing clears the mark until row 37's host-confirmed reset"
            ));
        }
        let raw = self.backend.host_consent();
        self.funnel.control.chord_tamper.refused(raw.as_ref());
        self.funnel.control.consent.mark_tampered();
    }

    /// The read at engine start (`--stdio`), before any session opens.
    pub fn read_audit_at_start(&mut self) {
        self.read_audit_mark();
    }
}
