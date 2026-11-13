//! `waitFor`: one predicate, waited for on the settle's observer events and bounded by the
//! call's `timeout` (absent: the cap of the regime in force) on the backend's monotonic clock.
//! No predicate lists windows or polls a tree; the call ends on an observation of its target.

use omo_computer_core::backend::{NotificationFingerprint, Refusal};
use omo_computer_core::error::EngineCode;
use omo_computer_core::observation::{Observation, SettleOutcome};
use omo_computer_core::params::{ElementState, WaitForParams};
use omo_computer_core::requests::{read_wait_for, ReadRequest, WaitSpec};
use omo_computer_core::results::{NotificationMatch, WaitOutcome, WaitResult};
use omo_computer_core::untrusted::UntrustedText;

use crate::observe::{observe, Request};
use crate::refs::Unresolved;
use crate::session::{Session, NOT_OPEN};
use crate::settle::{feed, EventMatch, Feed, Settled};

/// `waitFor({notification:{}})` names neither `app` nor `title`: refused at the call.
pub const NOTIFICATION_UNNAMED: Refusal = Refusal::bare(EngineCode::InvalidTarget);

/// A backend without accessibility reads.
const NO_READER: Refusal = Refusal::new(EngineCode::AxUnsupported, "snapshot_unsupported");

/// A null-mode session has no `waitFor`.
const NO_CAPTURE: Refusal = Refusal::new(EngineCode::CaptureUnavailable, "capture_unsupported");

const fn settle_outcome(outcome: SettleOutcome) -> WaitOutcome {
    match outcome {
        SettleOutcome::Settled => WaitOutcome::Settled,
        SettleOutcome::Pending => WaitOutcome::Pending,
        SettleOutcome::Unsupported => WaitOutcome::Unsupported,
        SettleOutcome::Timeout => WaitOutcome::Timeout,
    }
}

fn named(app: Option<&str>, title: Option<&str>, seen: &NotificationFingerprint) -> bool {
    app.is_none_or(|app| seen.app == app) && title.is_none_or(|title| seen.title.contains(title))
}

fn fingerprint(seen: NotificationFingerprint) -> NotificationMatch {
    NotificationMatch {
        app: seen.app,
        title: seen.title,
        body_hash: seen.body_hash,
        arrived_at: seen.arrived_at_ms,
        observation: UntrustedText,
    }
}

impl Session {
    /// # Errors
    /// [`NOT_OPEN`], a null-mode session, an unnamed `{notification}`, a backend without a
    /// notification surface, or the observation's refusal.
    pub fn wait_for(&mut self, params: WaitForParams) -> Result<WaitResult, Unresolved> {
        let opened = self.opened.as_ref().ok_or(NOT_OPEN)?;
        if opened.report_mode != omo_computer_core::params::ReportMode::Object {
            return Err(NO_CAPTURE.into());
        }
        let ReadRequest::WaitFor {
            target,
            predicate,
            timeout_ms,
        } = read_wait_for(params)
        else {
            unreachable!("read_wait_for always reads a waitFor");
        };
        let timeout_ms = timeout_ms.unwrap_or(self.settle.regime.numbers().cap_ms);
        let mut settled = None;
        let mut notification = None;
        let outcome = match predicate {
            WaitSpec::Settle(spec) => {
                settled = self.settle_before_read(&target, Some(spec), Some(timeout_ms));
                settled
                    .as_ref()
                    .map_or(WaitOutcome::Settled, |s| settle_outcome(s.outcome))
            }
            WaitSpec::Notification { app, title } => {
                if app.is_none() && title.is_none() {
                    return Err(NOTIFICATION_UNNAMED.into());
                }
                let found = self.wait_notification(app.as_deref(), title.as_deref(), timeout_ms)?;
                let outcome = found.0;
                notification = found.1.map(fingerprint);
                outcome
            }
            WaitSpec::Window { state, title, app } => {
                self.wait_event_match(&EventMatch::Window { state, title, app }, timeout_ms)
            }
            WaitSpec::Surface { kind, state } => {
                self.wait_event_match(&EventMatch::Surface { kind, state }, timeout_ms)
            }
            WaitSpec::Event(kind) => self.wait_event_match(&EventMatch::Event(kind), timeout_ms),
            WaitSpec::Text(text) => self.wait_observed(&target, timeout_ms, |_, o| {
                o.tree.as_deref().is_some_and(|tree| tree.contains(&text))
            })?,
            WaitSpec::Element { reference, state } => {
                self.wait_observed(&target, timeout_ms, |s, _| s.element_in(&reference, state))?
            }
            // The session-state sampler that would feed it is row 22's.
            WaitSpec::Session(_) => WaitOutcome::Unsupported,
        };
        let mut observation = self.observe_now(&target)?;
        observation.settle = settled.as_ref().map(Settled::wire);
        Ok(WaitResult {
            outcome,
            observation: Box::new(observation),
            notification,
        })
    }

    fn observe_now(&mut self, target: &str) -> Result<Observation, Unresolved> {
        let reader = self.backend.ax_reader().ok_or(NO_READER)?;
        observe(&mut self.refs, reader, &Request::of(target))
    }

    /// Waits for an observer event that `wanted` matches.
    fn wait_event_match(&mut self, wanted: &EventMatch, timeout_ms: u64) -> WaitOutcome {
        let Some(mut feed) = feed(self.backend.as_mut()) else {
            return WaitOutcome::Unsupported;
        };
        let deadline = feed.now_ms().saturating_add(timeout_ms);
        loop {
            match feed.wait_event(deadline) {
                Err(_) => return WaitOutcome::Unsupported,
                Ok(None) => return WaitOutcome::Timeout,
                Ok(Some(event)) => {
                    if wanted.matches(&event, feed.backend().ax_reader()) {
                        return WaitOutcome::Matched;
                    }
                }
            }
        }
    }

    /// Waits for a fingerprint absent at the call that names `app` / `title`.
    fn wait_notification(
        &mut self,
        app: Option<&str>,
        title: Option<&str>,
        timeout_ms: u64,
    ) -> Result<(WaitOutcome, Option<NotificationFingerprint>), Refusal> {
        let Some(mut feed) = feed(self.backend.as_mut()) else {
            return Ok((WaitOutcome::Unsupported, None));
        };
        let present = feed.notifications()?;
        let deadline = feed.now_ms().saturating_add(timeout_ms);
        loop {
            match feed.wait_event(deadline) {
                Err(_) => return Ok((WaitOutcome::Unsupported, None)),
                Ok(None) => return Ok((WaitOutcome::Timeout, None)),
                Ok(Some(_)) => {
                    let new = feed
                        .notifications()?
                        .into_iter()
                        .find(|seen| !present.contains(seen) && named(app, title, seen));
                    if let Some(seen) = new {
                        return Ok((WaitOutcome::Matched, Some(seen)));
                    }
                }
            }
        }
    }

    /// Re-observes `target` on each of its observer events until `done` holds.
    fn wait_observed(
        &mut self,
        target: &str,
        timeout_ms: u64,
        done: impl Fn(&mut Self, &Observation) -> bool,
    ) -> Result<WaitOutcome, Unresolved> {
        let start = feed(self.backend.as_mut()).map(|feed| feed.now_ms());
        let Some(start) = start else {
            return Ok(WaitOutcome::Unsupported);
        };
        let deadline = start.saturating_add(timeout_ms);
        loop {
            let observation = self.observe_now(target)?;
            if done(self, &observation) {
                return Ok(WaitOutcome::Matched);
            }
            let Some(mut feed) = feed(self.backend.as_mut()) else {
                return Ok(WaitOutcome::Unsupported);
            };
            loop {
                match feed.wait_event(deadline) {
                    Err(_) => return Ok(WaitOutcome::Unsupported),
                    Ok(None) => return Ok(WaitOutcome::Timeout),
                    Ok(Some(event)) if event.window == target => break,
                    Ok(Some(_)) => {}
                }
            }
        }
    }

    /// Whether the element `reference` names is in `state` now.
    fn element_in(&mut self, reference: &str, state: ElementState) -> bool {
        let Some(reader) = self.backend.ax_reader() else {
            return false;
        };
        match (self.refs.resolve(reference, true, reader), state) {
            (Err(_), ElementState::Gone) => true,
            (Err(_), _) | (Ok(_), ElementState::Gone) => false,
            (Ok(found), ElementState::Enabled) => found.live.enabled.unwrap_or(true),
            (Ok(found), ElementState::Visible) => found.live.bounds.is_some(),
        }
    }
}
