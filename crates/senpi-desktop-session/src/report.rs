//! Object-mode action reports (`reportMode: "object"`): how one mutating
//! request settled, mapped through [`Settled::disposition`]. A
//! `reportMode: "null"` session never reaches this module's output.

use senpi_desktop_core::error::{ErrorCode, ErrorReport};
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_results::{AuditEvent, AxInputResult};
use senpi_desktop_core::report::{
    ActionEffect, ActionHit, ActionReport, ActionRoute, End, FocusRestoration, Progress, ReportMode, Settled,
    StageTimings,
};

use crate::request::Response;

/// What a completed request's report names beyond its audit event: the
/// channel the input took and the element under the point before it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ReportExtras {
    pub(crate) route: Option<ActionRoute>,
    pub(crate) hit: Option<ActionHit>,
    /// `trace: true` sessions only.
    pub(crate) timings: Option<StageTimings>,
}

/// How far a mutating request got before it settled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Stage {
    /// Admission, the gate, the control grant, the intervention wait, the
    /// focus/cursor capture or the pre-action stop check: no input was sent.
    Admission,
    /// The action itself was running.
    Acting,
    /// The action returned; a later stop check or the restore failed.
    Acted,
}

/// The units a request's audit event says were sent: typed text counts
/// Unicode scalars, everything else is one indivisible action.
fn progress(event: &AuditEvent) -> Progress {
    match (event.action, event.text_length, event.text_delivered) {
        (Method::TypeText | Method::AxTypeText, Some(of), Some(count)) => {
            Progress::Counted { count, of }
        }
        _ => Progress::Atomic,
    }
}

/// Codes a stop, a cancellation or the user raise between units.
const fn interruption(code: ErrorCode) -> Option<bool> {
    match code {
        ErrorCode::Suspended | ErrorCode::StopPathUnavailable | ErrorCode::UserIntervened => {
            Some(true)
        }
        ErrorCode::Cancelled => Some(false),
        _ => None,
    }
}

const fn needs_user(code: ErrorCode) -> bool {
    matches!(
        code,
        ErrorCode::Suspended
            | ErrorCode::StopPathUnavailable
            | ErrorCode::PermissionDenied
            | ErrorCode::ScreenLocked
            | ErrorCode::ControlRequired
            | ErrorCode::UserIntervened
            | ErrorCode::CaptureConsentRequired
    )
}

/// How a request settled: `None` is success, otherwise the primary error's
/// code (a restore failure passes the error it followed, or `None`).
pub(crate) fn settled(primary: Option<ErrorCode>, stage: Stage, progress: Progress) -> Settled {
    let ran = |end: End| {
        Settled::ran(progress, end).unwrap_or(Settled::Ran {
            progress: Progress::Atomic,
            end,
        })
    };
    let Some(code) = primary else {
        return ran(End::Completed { verified: false });
    };
    match stage {
        Stage::Admission => Settled::Refused {
            needs_user: needs_user(code),
        },
        Stage::Acted => ran(End::Interrupted {
            needs_user: needs_user(code),
        }),
        Stage::Acting => acting(code, progress),
    }
}

/// An error the action itself raised. Every code is listed: a new code must
/// decide whether it can follow sent input.
fn acting(code: ErrorCode, progress: Progress) -> Settled {
    let ran = |end: End| {
        Settled::ran(progress, end).unwrap_or(Settled::Ran {
            progress: Progress::Atomic,
            end,
        })
    };
    match code {
        ErrorCode::PermissionDenied
        | ErrorCode::CaptureFailed
        | ErrorCode::BackgroundUnavailable
        | ErrorCode::WindowNotFound
        | ErrorCode::InvalidTarget
        | ErrorCode::InvalidKey
        | ErrorCode::InvalidCoordinateFrame
        | ErrorCode::StaleRef
        | ErrorCode::AxUnsupported
        | ErrorCode::Closed
        | ErrorCode::ScreenLocked
        | ErrorCode::TransactionFailed
        | ErrorCode::InputBusy
        | ErrorCode::ControlRequired
        | ErrorCode::CaptureUnavailable
        | ErrorCode::SpaceUnsupported
        | ErrorCode::AmbiguousTarget
        | ErrorCode::CaptureConsentRequired
        | ErrorCode::ProtectedProcess => match progress {
            // Raised between units after some were sent: report the partial delivery.
            Progress::Counted { count, .. } if count > 0 => ran(End::Interrupted {
                needs_user: needs_user(code),
            }),
            Progress::Counted { .. } | Progress::Atomic => Settled::Refused {
                needs_user: needs_user(code),
            },
        },
        ErrorCode::Suspended
        | ErrorCode::StopPathUnavailable
        | ErrorCode::UserIntervened
        | ErrorCode::Cancelled => {
            match (progress, interruption(code)) {
                // Counted input stops between units, so the count is exact.
                (Progress::Counted { .. }, Some(needs_user)) => {
                    ran(End::Interrupted { needs_user })
                }
                // An uncounted action cannot say whether it got as far as its first event.
                _ => ran(End::Uncertain { repeat_known: true }),
            }
        }
        ErrorCode::AxUnconfirmed | ErrorCode::Timeout => ran(End::Uncertain { repeat_known: true }),
        ErrorCode::InputFailed | ErrorCode::AxFailed | ErrorCode::SpaceMoveDenied => {
            ran(End::Uncertain {
                repeat_known: false,
            })
        }
        ErrorCode::Internal | ErrorCode::CursorRestoreFailed | ErrorCode::FocusRestoreFailed => {
            Settled::Unknowable
        }
    }
}

pub(crate) fn error_report(
    primary: Option<ErrorCode>,
    stage: Stage,
    event: &AuditEvent,
) -> ErrorReport {
    let settled = settled(primary, stage, progress(event));
    ErrorReport {
        reason: None,
        disposition: Some(settled.disposition()),
        delivered: settled.delivered(),
        focus_restoration: Some(FocusRestoration::from_restored(event.focus_restored)),
    }
}

/// The report of a request that completed: delivered, effect not read back.
pub(crate) fn success_report(event: &AuditEvent, extras: ReportExtras) -> ActionReport {
    let settled = settled(None, Stage::Acted, progress(event));
    ActionReport {
        disposition: settled.disposition(),
        delivered: settled.delivered(),
        effect: ActionEffect::Unverifiable,
        route: extras.route,
        hit: extras.hit,
        focus_restoration: FocusRestoration::from_restored(event.focus_restored),
        opened_surfaces: Vec::new(),
        next_call: None,
        note: None,
        warning: None,
        timings: extras.timings,
        audit_ids: event.id.iter().cloned().collect(),
    }
}

pub(crate) fn respond(
    mode: ReportMode,
    response: Response,
    event: &AuditEvent,
    extras: ReportExtras,
) -> Response {
    if mode == ReportMode::Null {
        return response;
    }
    match response {
        Response::Unit => Response::Action(Box::new(success_report(event, extras))),
        Response::AxInput(AxInputResult { method, .. }) => Response::AxInput(AxInputResult {
            method,
            report: Some(Box::new(success_report(event, extras))),
        }),
        other => other,
    }
}

#[cfg(test)]
mod tests;
