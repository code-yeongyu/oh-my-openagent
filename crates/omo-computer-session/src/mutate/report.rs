//! The reply of a completed send: `null` in a null-mode session, the `ActionReport` in an
//! object-mode one. Nothing here reads a receipt yet, so a send reads `delivered_unverified`
//! with effect `unverifiable` until the evidence rows add read-backs.

use omo_computer_core::backend::Route;
use omo_computer_core::methods::Method;
use omo_computer_core::params::ReportMode;
use omo_computer_core::report::{
    ActionReport, Delivered, Disposition, Effect, ReportContext, ReportParts, ReportRejection,
    VerbClass,
};
use omo_computer_core::results::ExecReply;
use omo_computer_core::untrusted::UntrustedText;

/// What the read-back step found: nothing yet (the evidence rows fill it).
pub(super) struct ReadBack {
    pub(super) effect: Effect,
}

/// The settle stage: a typed step that returns at once with `settle` absent; row 19
/// supplies the policy behind it.
pub(super) const fn settle() -> Option<omo_computer_core::report::Settle> {
    None
}

pub(super) const fn read_back(_settle: Option<omo_computer_core::report::Settle>) -> ReadBack {
    ReadBack {
        effect: Effect::Unverifiable,
    }
}

pub(super) struct Sent {
    pub(super) route: Route,
    pub(super) count: u32,
    pub(super) of: u32,
    pub(super) effect: Effect,
    pub(super) audit_id: Option<String>,
    pub(super) warning: Option<String>,
}

/// # Errors
/// The report breaks a wire rule (a defect of this module).
pub(super) fn reply(
    mode: ReportMode,
    method: Method,
    sent: Sent,
) -> Result<ExecReply, ReportRejection> {
    if mode != ReportMode::Object {
        return Ok(ExecReply(None));
    }
    let verb = VerbClass::of(method).unwrap_or(VerbClass::Action);
    let parts = ReportParts {
        disposition: Disposition::DELIVERED_UNVERIFIED,
        delivered: Some(Delivered {
            count: sent.count,
            of: sent.of,
        }),
        effect: sent.effect,
        route: sent.route.into(),
        hit: None,
        focus_restoration: None,
        opened_surfaces: Vec::new(),
        next_call: None,
        note: None,
        warning: sent.warning,
        audit_ids: sent.audit_id.into_iter().collect(),
        timings: None,
        evidence: Vec::new(),
        observation: UntrustedText,
    };
    ActionReport::new(ReportContext::new(verb, None), parts).map(|report| ExecReply(Some(report)))
}
