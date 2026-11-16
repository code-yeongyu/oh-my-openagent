//! The per-app record of the user's own keys and clicks (ported from oh-my-pi
//! `desktop/control/intervention.rs` at 0838d2ab44, MIT), in the session
//! clock's milliseconds so a fake clock drives it in tests.
//!
//! Invariants (checked after every step by
//! `tests::every_interleaving_of_presses_reads_and_time_keeps_the_invariants`):
//!
//! 1. An app's last press only moves forward: no later record of an earlier
//!    press (a kept press, a dropped one stamped at the oldest kept, a press
//!    learned late) moves it back.
//! 2. A read clears the record only when it began at least `QUIET_MS` after
//!    the last REAL press, and only once its reply reached the caller (the
//!    session tells the record after delivery).
//! 3. Dropped or unknown presses never clear anything: they count as a press
//!    into every watched app, stamped no later than the oldest press kept.
//! 4. Admission needs nothing the input does not use: no feed means no window
//!    list and no wait; an unknown process start on either side is no evidence
//!    of a new process, so the record stays.
//! 5. Input into an app the session never touched, or before it touched it,
//!    is the user's own and never refuses.
//! 6. An app with an unread press is never admitted; an admitted input holds
//!    a baseline of the app's press counter, which only grows, and any press
//!    counted into the app after the baseline (kept, routed from a helper
//!    process, or dropped/unknown) refuses the next check.
//! 7. A process reusing a watched id with a different known start time starts
//!    unwatched: the earlier process's presses are not held against it.

use std::collections::HashMap;

use parking_lot::Mutex;
use senpi_desktop_core::error::{CoreResult, DesktopError};

/// How long the user leaves an app alone before a read of it shows what they
/// left there.
pub(crate) const QUIET_MS: u64 = 5_000;
/// Time left before the request's limit for the refusal to reach the caller.
pub(crate) const DEADLINE_MARGIN_MS: u64 = 250;
const READ_AGAIN: &str = "read the window again (win.ax(), win.observe() or win.screenshot()) before acting on it";

struct App {
    name: String,
    /// When the process started; a later process reusing its id starts later.
    started: Option<u64>,
    /// The user's key presses and clicks since the session first touched it.
    inputs: u64,
    /// When the user last pressed a key or clicked there, until a read shows it.
    unread: Option<u64>,
}

/// A process that takes input for a watched app's windows, such as the
/// service that draws its Open or Save panel.
struct Route {
    app: u32,
    started: Option<u64>,
}

#[derive(Default)]
struct State {
    apps: HashMap<u32, App>,
    routes: HashMap<u32, Route>,
}

/// When process `pid` started, or `None` when that cannot be told.
pub(crate) type Started = Box<dyn Fn(u32) -> Option<u64> + Send + Sync>;

/// The user's input into each app this session has read or sent input to.
pub(crate) struct UserInputs {
    state: Mutex<State>,
    started: Started,
}

/// The press counter an admitted input call compares against before each press.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Baseline(pub(crate) u64);

impl UserInputs {
    pub(crate) fn new(started: Started) -> Self {
        Self { state: Mutex::default(), started }
    }

    /// Starts recording the user's input into `pid`, which started at
    /// `started`. Input into an app before the session first reads it or acts
    /// on it is not the agent's concern, nor is a former process's under the
    /// same id.
    pub(crate) fn touch(&self, pid: u32, started: Option<u64>, name: impl FnOnce() -> String) {
        // A start time unknown on either side (`None`) is no evidence of a new
        // process: the record the session has stays. Only two known, different
        // start times name a process reusing the id.
        if self.state.lock().apps.get(&pid).is_some_and(|app| started.is_none() || app.started.is_none() || app.started == started) {
            return;
        }
        let name = name();
        let mut state = self.state.lock();
        state.apps.insert(pid, App { name, started, inputs: 0, unread: None });
        state.routes.retain(|_, route| route.app != pid);
    }

    /// Counts the user's input into `input` as input into the watched `app`
    /// while `input` is the process it is now.
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "helper-process routing (an app's Open/Save panel service) has no caller yet: the macOS backend posts to the window owner only")
    )]
    pub(crate) fn route(&self, input: u32, app: u32) {
        if input != app {
            let started = (self.started)(input);
            self.state.lock().routes.insert(input, Route { app, started });
        }
    }

    /// The user pressed a key or clicked in `pid` at `at_ms`.
    pub(crate) fn record(&self, pid: u32, at_ms: u64) {
        let mut state = self.state.lock();
        let route = state.routes.get(&pid).map(|route| (route.app, route.started));
        let pid = match route {
            Some((app, started)) if started == (self.started)(pid) => app,
            Some(_) => {
                state.routes.remove(&pid);
                pid
            }
            None => pid,
        };
        if let Some(app) = state.apps.get_mut(&pid) {
            app.inputs += 1;
            app.unread = Some(app.unread.map_or(at_ms, |unread| unread.max(at_ms)));
        }
    }

    /// Presses the bounded watch let go belong to an unknown app: every
    /// watched app counts as used at `at_ms`.
    pub(crate) fn record_unknown(&self, at_ms: u64) {
        for app in self.state.lock().apps.values_mut() {
            app.inputs += 1;
            // The user's last press never moves backward: a later press the
            // session already knows of stays the last one.
            app.unread = Some(app.unread.map_or(at_ms, |unread| unread.max(at_ms)));
        }
    }

    /// A read of one of `pid`'s windows that began at `started_ms` reached the
    /// caller. It shows the user's input only if they had paused for
    /// [`QUIET_MS`] by then.
    pub(crate) fn read(&self, pid: u32, started_ms: u64) {
        if let Some(app) = self.state.lock().apps.get_mut(&pid) {
            if app.unread.is_some_and(|last| started_ms.saturating_sub(last) >= QUIET_MS) {
                app.unread = None;
            }
        }
    }

    /// Admits input to `pid`: input to an app holding input no read has shown
    /// waits until the user has paused for [`QUIET_MS`], or until shortly
    /// before `deadline_ms` (one quiet period without one), then fails without
    /// sending anything. `wait` sleeps the given milliseconds and may end the
    /// wait with a cancel or stop error.
    pub(crate) fn admit(
        &self,
        pid: u32,
        deadline_ms: Option<u64>,
        clock: impl Fn() -> u64,
        mut wait: impl FnMut(u64) -> CoreResult<()>,
    ) -> CoreResult<Baseline> {
        let limit = deadline_ms.map_or_else(|| clock() + QUIET_MS, |deadline| deadline.saturating_sub(DEADLINE_MARGIN_MS));
        loop {
            let (baseline, unread) = self
                .state
                .lock()
                .apps
                .get(&pid)
                .map_or((0, None), |app| (app.inputs, app.unread.map(|last| (last, app.name.clone()))));
            let Some((last, name)) = unread else {
                return Ok(Baseline(baseline));
            };
            let now = clock();
            let idle = now.saturating_sub(last);
            let seconds = idle as f64 / 1000.0;
            if idle >= QUIET_MS {
                return Err(DesktopError::user_intervened(format!(
                    "the user was using {name} (last input {seconds:.1} s ago); nothing was sent; {READ_AGAIN}"
                )));
            }
            if now >= limit {
                return Err(DesktopError::user_intervened(format!(
                    "the user is still using {name} (last input {seconds:.1} s ago); nothing was sent; once they \
                     pause, {READ_AGAIN}"
                )));
            }
            wait((last + QUIET_MS).min(limit).saturating_sub(now))?;
            // A clock that did not move across the wait cannot show a pause:
            // refuse as at the limit rather than spin.
            if clock() <= now {
                return Err(DesktopError::user_intervened(format!(
                    "the user is still using {name} (last input {seconds:.1} s ago); nothing was sent; once they \
                     pause, {READ_AGAIN}"
                )));
            }
        }
    }

    /// Before a press of an admitted call: refuses once the user has pressed a
    /// key or clicked in `pid` since `baseline`, so at most the press already
    /// under way lands after theirs.
    pub(crate) fn check(&self, pid: u32, baseline: Baseline) -> CoreResult<()> {
        match self.state.lock().apps.get(&pid) {
            Some(app) if app.inputs != baseline.0 => Err(DesktopError::user_intervened(format!(
                "the user pressed a key or clicked in {} during this input; input sent before that may already \
                 have landed, and nothing more was sent; {READ_AGAIN}",
                app.name,
            ))),
            _ => Ok(()),
        }
    }

    #[cfg(test)]
    pub(crate) fn state_of(&self, pid: u32) -> Option<(u64, Option<u64>)> {
        self.state.lock().apps.get(&pid).map(|app| (app.inputs, app.unread))
    }
}
