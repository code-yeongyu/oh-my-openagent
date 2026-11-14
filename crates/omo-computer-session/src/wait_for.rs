//! `waitFor`: one predicate, waited for on the settle's observer events and bounded by the
//! call's `timeout` (absent: the cap of the regime in force) on the backend's monotonic clock.
//! No predicate polls a tree. A gone wait and an event `window_closed` wait read the window
//! listing: once to name the windows a gone wait tracks, once to confirm a gone event (an
//! event is a hint, never the answer), and once to tell whether the target itself went away.
//! The call ends on an observation of its target, or of nothing when the target is gone.

use omo_computer_core::backend::{NotificationFingerprint, Refusal, WindowFilter};
use omo_computer_core::error::EngineCode;
use omo_computer_core::observation::{Observation, SettleOutcome};
use omo_computer_core::params::{
    ElementState, EventKind, SurfaceState, WaitForParams, WindowState,
};
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
        // Whether the match is the target window going away: then there is nothing to observe.
        let mut target_gone = false;
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
                // A closed window cannot be read, so a gone wait names the windows it tracks
                // up front: the target, or the windows the title and app pick (one listing).
                let only = (state == WindowState::Gone)
                    .then(|| self.tracked_windows(&target, title.as_deref(), app.as_deref()))
                    .transpose()?;
                let outcome = self.wait_event_match(
                    &EventMatch::Window { state, title, app },
                    only.as_deref(),
                    state == WindowState::Gone,
                    timeout_ms,
                )?;
                // A confirmed gone match on a set that held the target: it is no longer listed.
                target_gone = outcome == WaitOutcome::Matched
                    && only.as_deref().is_some_and(|ids| ids.contains(&target))
                    && !self.target_listed(&target)?;
                outcome
            }
            WaitSpec::Surface { kind, state } => {
                let outcome = self.wait_event_match(
                    &EventMatch::Surface { kind, state },
                    None,
                    false,
                    timeout_ms,
                )?;
                target_gone = outcome == WaitOutcome::Matched
                    && state == SurfaceState::Gone
                    && !self.target_listed(&target)?;
                outcome
            }
            // An event wait counts events on its target window; a window that opens is never
            // the target, so `window_opened` counts every new window.
            WaitSpec::Event(kind) => {
                let only = (kind != EventKind::WindowOpened).then(|| vec![target.clone()]);
                let outcome = self.wait_event_match(
                    &EventMatch::Event(kind),
                    only.as_deref(),
                    kind == EventKind::WindowClosed,
                    timeout_ms,
                )?;
                target_gone = outcome == WaitOutcome::Matched
                    && kind == EventKind::WindowClosed
                    && !self.target_listed(&target)?;
                outcome
            }
            WaitSpec::Text(text) => self.wait_observed(&target, timeout_ms, |_, o| {
                o.tree.as_deref().is_some_and(|tree| tree.contains(&text))
            })?,
            WaitSpec::Element { reference, state } => {
                self.wait_observed(&target, timeout_ms, |s, _| s.element_in(&reference, state))?
            }
            // The session-state sampler that would feed it is row 22's.
            WaitSpec::Session(_) => WaitOutcome::Unsupported,
        };
        let mut observation = if target_gone {
            self.nothing_observed(&target)
        } else {
            self.observe_now(&target)?
        };
        observation.settle = settled.as_ref().map(Settled::wire);
        Ok(WaitResult {
            outcome,
            observation: Box::new(observation),
            notification,
        })
    }

    /// Whether `target` is still in the window listing.
    ///
    /// # Errors
    /// The listing's refusal.
    fn target_listed(&mut self, target: &str) -> Result<bool, Refusal> {
        Ok(self
            .backend
            .windows(&WindowFilter::default())?
            .windows
            .iter()
            .any(|window| window.id == target))
    }

    /// The observation of a target the wait just confirmed gone (ruling R70bi): no frame, no
    /// tree, nothing observed, complete, at the current generation. A closed window is never
    /// observed, so it never answers `WindowNotFound`.
    fn nothing_observed(&self, target: &str) -> Observation {
        Observation {
            frame: None,
            tree: None,
            diff: None,
            diff_fallback: None,
            baseline: None,
            focused: None,
            selected_text: None,
            complete: true,
            nodes_observed: 0,
            cuts: Vec::new(),
            generation: self
                .refs
                .latest(target)
                .map_or(0, |generation| generation.number),
            session: omo_computer_core::backend::unknown_session_state(),
            observation: UntrustedText,
            secure: None,
            settle: None,
            ocr: None,
        }
    }

    fn observe_now(&mut self, target: &str) -> Result<Observation, Unresolved> {
        let reader = self.backend.ax_reader().ok_or(NO_READER)?;
        observe(&mut self.refs, reader, &Request::of(target))
    }

    /// The windows a gone wait tracks: `target` when neither title nor app is named, else every
    /// listed window whose title contains `title` and whose app is `app`.
    fn tracked_windows(
        &mut self,
        target: &str,
        title: Option<&str>,
        app: Option<&str>,
    ) -> Result<Vec<String>, Refusal> {
        if title.is_none() && app.is_none() {
            return Ok(vec![target.to_owned()]);
        }
        // A failed listing is answered: an empty set would wait the whole timeout for nothing.
        Ok(self
            .backend
            .windows(&WindowFilter::default())?
            .windows
            .into_iter()
            .filter(|window| {
                title.is_none_or(|wanted| window.title.contains(wanted))
                    && app.is_none_or(|wanted| window.app == wanted)
            })
            .map(|window| window.id)
            .collect())
    }

    /// Waits for an event `wanted` matches, on one of the windows in `only` when it is given.
    /// A gone match (`confirm_gone`) is a hint, never the answer: it is confirmed by the same
    /// window listing the title and app branch tracks from, and a window still listed keeps
    /// the wait going (a destroyed child raises the same event as the window closing).
    ///
    /// # Errors
    /// The confirming listing's refusal.
    fn wait_event_match(
        &mut self,
        wanted: &EventMatch,
        only: Option<&[String]>,
        confirm_gone: bool,
        timeout_ms: u64,
    ) -> Result<WaitOutcome, Refusal> {
        let Some(mut feed) = feed(self.backend.as_mut()) else {
            return Ok(WaitOutcome::Unsupported);
        };
        let deadline = feed.now_ms().saturating_add(timeout_ms);
        loop {
            match feed.wait_event(deadline) {
                Err(_) => return Ok(WaitOutcome::Unsupported),
                Ok(None) => return Ok(WaitOutcome::Timeout),
                Ok(Some(event)) => {
                    let on_tracked = only.is_none_or(|ids| ids.contains(&event.window));
                    if !(on_tracked && wanted.matches(&event, feed.backend().ax_reader())) {
                        continue;
                    }
                    if !confirm_gone {
                        return Ok(WaitOutcome::Matched);
                    }
                    let listed = feed.backend().windows(&WindowFilter::default())?.windows;
                    let still = only
                        .unwrap_or_default()
                        .iter()
                        .any(|id| listed.iter().any(|w| &w.id == id));
                    if !still {
                        return Ok(WaitOutcome::Matched);
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
