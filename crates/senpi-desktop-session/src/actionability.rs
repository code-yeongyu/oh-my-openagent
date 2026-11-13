//! The actionability battery (DESIGN 2 A6), run before an accessibility
//! action in an object-mode session: the element must be visible, keep its
//! bounds across two reads, be enabled, support the action, and not be
//! covered by another element of its own window. A hit test that cannot tell
//! (no element, no owner) passes. Transient states (hidden, moving, covered)
//! are waited on for up to [`AUTO_WAIT`]; terminal ones (disabled while
//! visible and still, an action the element does not offer) refuse at once.
//! The wait sends nothing, so it runs before the machine-wide interaction
//! lock is taken; under the lock the element is observed once more, without
//! waiting, and a target that regressed meanwhile is refused the same way.
//! Every refusal is `AxUnsupported` with nothing sent. A session without
//! `reportMode: "object"` acts at once, as protocol 1 did.

use std::time::{Duration, Instant};

use senpi_desktop_core::ax::{AxBounds, AxHandle, AxOwner};
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode, ErrorReport};
use senpi_desktop_core::report::{Disposition, ReportMode};

use crate::mutate::Mutation;
use crate::timings::TimedStage;
use crate::worker::Worker;
use crate::worker_input::interrupted;

/// How long the battery waits for a hidden, moving or covered element.
pub(crate) const AUTO_WAIT: Duration = Duration::from_secs(5);

const POLL: Duration = Duration::from_millis(50);

/// The time the battery waits on: the host's in a session; a test swaps in
/// its fake's clock so the wait does not depend on how busy the host is.
pub(crate) trait BatteryClock {
    fn now(&self) -> Duration;
    fn sleep(&self, pause: Duration);
}

/// The host's monotonic time, from when the worker was built.
pub(crate) struct HostClock(Instant);

impl HostClock {
    pub(crate) fn new() -> Self {
        Self(Instant::now())
    }
}

impl BatteryClock for HostClock {
    fn now(&self) -> Duration {
        self.0.elapsed()
    }

    fn sleep(&self, pause: Duration) {
        std::thread::sleep(pause);
    }
}

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
    /// Waits up to [`AUTO_WAIT`] for the mutation's element to become
    /// actionable, before the capture and the machine-wide lock; the bounds
    /// it settled on are what [`Self::assert_actionable_now`] expects.
    pub(crate) fn wait_until_actionable(
        &mut self,
        mutation: &Mutation<'_>,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Option<AxBounds>> {
        let Some((reference, action)) = self.battery_target(mutation) else { return Ok(None) };
        let interrupted = self.battery_interruption(cancelled);
        mutation.timings.time(TimedStage::AxResolve, || {
            let handle = self.registry.resolve(reference).map_err(nothing_sent)?;
            self.actionability(reference, &handle, action, &interrupted, None, true)
        })
    }

    /// One observation under the lock, no wait: the element must still be
    /// actionable at the bounds the wait settled on (`previous`).
    pub(crate) fn assert_actionable_now(
        &mut self,
        mutation: &Mutation<'_>,
        cancelled: &dyn Fn() -> bool,
        previous: Option<AxBounds>,
    ) -> CoreResult<()> {
        let Some((reference, action)) = self.battery_target(mutation) else { return Ok(()) };
        let interrupted = self.battery_interruption(cancelled);
        mutation.timings.time(TimedStage::AxResolve, || {
            let handle = self.registry.resolve(reference).map_err(nothing_sent)?;
            self.actionability(reference, &handle, action, &interrupted, previous, false).map(|_| ())
        })
    }

    /// The element and offered action the battery checks: only in an
    /// object-mode session, which a protocol-1 session is not.
    fn battery_target<'a>(&self, mutation: &Mutation<'a>) -> Option<(&'a str, Option<&'a str>)> {
        mutation.ax_actionability.filter(|_| self.registry.report_mode() == ReportMode::Object)
    }

    /// Runs the battery on `handle` (named `reference` in errors) before
    /// `action` (`None` for a value write, a focus or a coordinate click).
    /// `interrupted` is checked before every read, so a stop or a
    /// cancellation ends the wait with nothing sent. With `wait` false it
    /// reads once and refuses any state it would have waited out.
    fn actionability(
        &mut self,
        reference: &str,
        handle: &AxHandle,
        action: Option<&str>,
        interrupted: &dyn Fn() -> CoreResult<()>,
        mut previous: Option<AxBounds>,
        wait: bool,
    ) -> CoreResult<Option<AxBounds>> {
        let deadline = self.battery_clock.now() + AUTO_WAIT;
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
                    if first && wait {
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
                Some(bounds) => return Ok(Some(bounds)),
            };
            let now = self.battery_clock.now();
            if !wait || now >= deadline {
                return Err(refusal(
                    pending.reason(),
                    format!(
                        "{reference} {} within {} s; nothing was sent; take a fresh snapshot",
                        pending.condition(),
                        AUTO_WAIT.as_secs()
                    ),
                ));
            }
            self.battery_clock.sleep(POLL.min(deadline - now));
        }
    }

    /// The stop and cancellation check the battery runs before each read of
    /// the element it waits on.
    fn battery_interruption<'a>(
        &self,
        cancelled: &'a dyn Fn() -> bool,
    ) -> impl Fn() -> CoreResult<()> + 'a {
        let supervisor = self.safety.supervisor.clone();
        let policy = self.stop_policy();
        move || interrupted(&supervisor, &policy, cancelled, "waiting for the element to become actionable")
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
/// `press` names the element's default (first) action, so any non-empty
/// list offers it, as the backends perform it; any other action must be
/// listed by name.
fn supports(actions: &[String], action: &str) -> bool {
    let wanted = action_name(action);
    wanted == "press" || actions.is_empty() || actions.iter().any(|offered| action_name(offered) == wanted)
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
