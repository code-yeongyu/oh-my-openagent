//! The actionability battery (DESIGN 2 A6), run before an accessibility
//! action in an object-mode session: the element must be visible, keep its
//! bounds across two reads, be enabled, support the action, and not be
//! covered by another element of its own window. A hit test that cannot tell
//! (no element, no owner) passes. Transient states (hidden, moving, covered)
//! are waited on for up to [`AUTO_WAIT`]; terminal ones (disabled while
//! visible and still, an action the element does not offer) refuse at once.
//! Every refusal is `AxUnsupported` with nothing sent. A session without
//! `reportMode: "object"` acts at once, as protocol 1 did.

use std::time::{Duration, Instant};

use senpi_desktop_core::ax::{AxBounds, AxHandle, AxOwner};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode, ErrorReport};
use senpi_desktop_core::report::{Disposition, ReportMode};

use crate::worker::Worker;

/// How long the battery waits for a hidden, moving or covered element.
pub(crate) const AUTO_WAIT: Duration = Duration::from_secs(5);

const POLL: Duration = Duration::from_millis(50);

/// A state the battery waits out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pending {
    NotVisible,
    Unstable,
    Occluded,
}

impl Pending {
    const fn reason(self) -> &'static str {
        match self {
            Self::NotVisible => "not_visible",
            Self::Unstable => "unstable",
            Self::Occluded => "occluded",
        }
    }

    const fn condition(self) -> &'static str {
        match self {
            Self::NotVisible => "did not become visible",
            Self::Unstable => "kept moving",
            Self::Occluded => "stayed covered by another element of its window",
        }
    }
}

impl Worker {
    /// Runs the battery on `handle` (named `reference` in errors) before
    /// `action` (`None` for a value write, a focus or a coordinate click).
    /// `interrupted` is checked before every read, so a stop or a
    /// cancellation ends the wait with nothing sent.
    pub(crate) fn actionable(
        &mut self,
        reference: &str,
        handle: &AxHandle,
        action: Option<&str>,
        interrupted: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<()> {
        if self.registry.report_mode() != ReportMode::Object {
            return Ok(());
        }
        let deadline = Instant::now() + AUTO_WAIT;
        let mut previous: Option<AxBounds> = None;
        loop {
            interrupted().map_err(nothing_sent)?;
            let props = self.ax_parts().and_then(|(ax, _)| ax.props(handle)).map_err(nothing_sent)?;
            if let Some(action) = action.filter(|action| !supports(&props.actions, action)) {
                return Err(refusal(
                    "action_unsupported",
                    format!(
                        "{reference} does not offer '{action}' (it offers {}); nothing was sent",
                        props.actions.join(", ")
                    ),
                ));
            }
            let pending = match props.bounds.filter(visible) {
                None => {
                    previous = None;
                    Pending::NotVisible
                }
                Some(bounds) if previous != Some(bounds) => {
                    let first = previous.is_none();
                    previous = Some(bounds);
                    if first {
                        // Stability is judged across two reads: read again at once.
                        continue;
                    }
                    Pending::Unstable
                }
                Some(_) if !props.enabled => {
                    return Err(refusal(
                        "disabled",
                        format!("{reference} is disabled; nothing was sent; read it again once the app enables it"),
                    ));
                }
                Some(bounds) if self.occluded(handle, &bounds) => Pending::Occluded,
                Some(_) => return Ok(()),
            };
            let now = Instant::now();
            if now >= deadline {
                return Err(refusal(
                    pending.reason(),
                    format!(
                        "{reference} {} within {} s; nothing was sent; take a fresh snapshot",
                        pending.condition(),
                        AUTO_WAIT.as_secs()
                    ),
                ));
            }
            std::thread::sleep(POLL.min(deadline - now));
        }
    }

    /// Whether the element under the centre of `bounds` is another element
    /// of the same window that neither contains nor sits inside the target.
    /// Anything the hit test cannot establish counts as not covered.
    fn occluded(&mut self, handle: &AxHandle, bounds: &AxBounds) -> bool {
        let (x, y) = (bounds.x + bounds.width / 2.0, bounds.y + bounds.height / 2.0);
        let Ok(backend) = self.backend() else { return false };
        let Ok(windows) = backend.windows() else { return false };
        let Some(ax) = backend.ax() else { return false };
        let Ok(Some(hit)) = ax.element_at(x, y) else { return false };
        let Some(hit_bounds) = ax.props(&hit).ok().and_then(|props| props.bounds) else {
            return false;
        };
        if contains(&hit_bounds, bounds) || contains(bounds, &hit_bounds) {
            return false;
        }
        matches!(
            (ax.owner(&hit, &windows), ax.owner(handle, &windows)),
            (Ok(AxOwner::Window(hit_window)), Ok(AxOwner::Window(own_window))) if hit_window == own_window
        )
    }
}

/// Whether the element offers `action`; an element that lists no actions
/// cannot say, and passes. `AXPress` and `press` name the same action.
fn supports(actions: &[String], action: &str) -> bool {
    actions.is_empty() || actions.iter().any(|offered| action_name(offered) == action_name(action))
}

fn action_name(action: &str) -> String {
    let lower = action.trim().to_ascii_lowercase();
    lower.strip_prefix("ax").map_or_else(|| lower.clone(), str::to_owned)
}

fn visible(bounds: &AxBounds) -> bool {
    bounds.width > 0.0 && bounds.height > 0.0
}

fn contains(outer: &AxBounds, inner: &AxBounds) -> bool {
    outer.x <= inner.x
        && outer.y <= inner.y
        && outer.x + outer.width >= inner.x + inner.width
        && outer.y + outer.height >= inner.y + inner.height
}

fn refusal(reason: &str, message: String) -> DesktopError {
    DesktopError::new(ErrorCode::AxUnsupported, message).with_report(ErrorReport {
        reason: Some(reason.to_owned()),
        disposition: Some(Disposition::NOT_DELIVERED_SAFE),
        ..ErrorReport::default()
    })
}

/// An error raised before the action was sent: whatever its code, nothing
/// reached the target.
fn nothing_sent(mut error: DesktopError) -> DesktopError {
    let mut report = error.report.take().map(|report| *report).unwrap_or_default();
    if report.disposition.is_none() {
        report.disposition = Some(if needs_user(error.code) {
            Disposition::NOT_DELIVERED_AFTER_USER
        } else {
            Disposition::NOT_DELIVERED_SAFE
        });
    }
    error.with_report(report)
}

const fn needs_user(code: ErrorCode) -> bool {
    matches!(
        code,
        ErrorCode::Suspended
            | ErrorCode::StopPathUnavailable
            | ErrorCode::PermissionDenied
            | ErrorCode::ScreenLocked
            | ErrorCode::UserIntervened
    )
}

#[cfg(test)]
#[path = "actionability/tests.rs"]
mod tests;
