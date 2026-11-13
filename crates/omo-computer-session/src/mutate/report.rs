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
    pub(super) paused: Vec<omo_computer_core::intervention::Pause>,
    pub(super) session: Option<omo_computer_core::session_state::SessionState>,
    pub(super) target: Option<omo_computer_core::intervention::TargetLiveness>,
    /// The foreground lease ended under the user since the last report.
    pub(super) user_moved_on: bool,
    /// Row 24: a value verb's read-back verdict (disposition, evidence, next call).
    pub(super) read_back: Option<crate::value_verbs::ReadBack>,
    /// Row 25: the browser window's URL could not be read under a non-empty `url_policy`.
    pub(super) url_unknown: bool,
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
        disposition: sent.read_back.as_ref().map_or(Disposition::DELIVERED_UNVERIFIED, |r| r.disposition),
        delivered: Some(Delivered {
            count: sent.count,
            of: sent.of,
        }),
        effect: sent.effect,
        route: sent.route.into(),
        hit: None,
        focus_restoration: sent
            .user_moved_on
            .then_some(omo_computer_core::report::FocusRestoration::UserMovedOn),
        opened_surfaces: Vec::new(),
        next_call: sent.read_back.as_ref().and_then(|r| r.next_call.clone()),
        note: sent.read_back.as_ref().and_then(|r| r.note.clone()),
        reason: None,
        nothing_sent: None,
        warning: sent.warning,
        audit_ids: sent.audit_id.into_iter().collect(),
        timings: None,
        evidence: sent.read_back.map(|r| r.evidence).unwrap_or_default(),
        url_policy: sent
            .url_unknown
            .then_some(omo_computer_core::url_policy::UrlPolicyStamp::Unknown),
        observation: UntrustedText,
        paused: sent.paused,
        session: sent.session,
        target: sent.target,
    };
    ActionReport::new(ReportContext::new(verb, None), parts).map(|report| ExecReply(Some(report)))
}

/// The reply of an `up` whose hold the ledger already released at the 100 s bound (row 23,
/// R49): effect `partial`, `delivered{count: 0, of: 1}`, nothing sent.
///
/// # Errors
/// `Internal` if the report breaks a wire rule (a defect of this module).
pub(crate) fn released_reply(mode: ReportMode, method: Method) -> Result<ExecReply, super::Refused> {
    let sent = Sent {
        route: Route::ForegroundHid,
        count: 0,
        of: 1,
        effect: Effect::Partial,
        audit_id: None,
        warning: None,
        paused: Vec::new(),
        session: None,
        target: None,
        user_moved_on: false,
        read_back: None,
        url_unknown: false,
    };
    reply(mode, method, sent).map_err(|_| {
        super::Refused::from(omo_computer_core::backend::Refusal::bare(omo_computer_core::error::EngineCode::Internal))
    })
}

/// An `effect:"refused"` report (R60a): nothing sent, `reason` and `nothingSent:true`,
/// disposition `not_delivered/after_user` (`design/d-sdk-skill.md`:555).
///
/// # Errors
/// `Internal` if the report breaks a wire rule (a defect of this module).
pub(crate) fn refused_reply(method: Method, reason: omo_computer_core::report::RefusalReason) -> Result<omo_computer_core::report::ActionReport, super::Refused> {
    let verb = VerbClass::of(method).unwrap_or(VerbClass::Action);
    let parts = ReportParts {
        disposition: Disposition::NOT_DELIVERED_AFTER_USER,
        delivered: None,
        effect: Effect::Refused,
        route: Route::BackgroundWindow.into(),
        hit: None,
        focus_restoration: None,
        url_policy: None,
        opened_surfaces: Vec::new(),
        next_call: None,
        note: None,
        reason: Some(reason),
        nothing_sent: Some(true),
        warning: None,
        audit_ids: Vec::new(),
        timings: None,
        evidence: Vec::new(),
        observation: UntrustedText,
        paused: Vec::new(),
        session: None,
        target: None,
    };
    ActionReport::new(ReportContext::new(verb, None), parts).map_err(|_| {
        super::Refused::from(omo_computer_core::backend::Refusal::bare(omo_computer_core::error::EngineCode::Internal))
    })
}
