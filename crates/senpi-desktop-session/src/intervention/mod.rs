//! User intervention (#11459, plan todo 17): the user's own keys and clicks
//! in the apps this session works in. A request that reads or acts on an app
//! starts recording the user's input there; input aimed at an app the user has
//! used since the session last read it waits for them to pause, then fails
//! `UserIntervened` without sending (`admit`); input already being sent stops
//! at the user's first key or click (`check_press`, run by the backend before
//! every press and AX write); a read that began after the user paused clears
//! the record (`read`). Fed by the backend's watch; without one nothing is
//! recorded and nothing waits.

mod record;

use std::cell::RefCell;
use std::sync::Arc;
use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};
use senpi_desktop_core::intervention::{watch, PressWatch};
use senpi_desktop_core::types::{DesktopWindow, Target};
use senpi_desktop_core::user_input::UserInputFeed;
use senpi_desktop_safety::{MutatingAction, Supervisor};

use crate::mutate::Mutation;
use crate::request::Op;
use crate::worker::Worker;

pub(crate) use self::record::{Baseline, UserInputs};
#[cfg(test)]
pub(crate) use self::record::QUIET_MS;

/// How often a waiting admission re-checks the cancel token and the stop.
const WAIT_SLICE: Duration = Duration::from_millis(50);

/// The session's record and its feed, per backend.
pub(crate) struct Intervention {
    inputs: Arc<UserInputs>,
    feed: Option<Arc<dyn UserInputFeed>>,
}

impl Intervention {
    pub(crate) fn new() -> Self {
        Self::with_feed(None)
    }

    fn with_feed(feed: Option<Arc<dyn UserInputFeed>>) -> Self {
        let started = feed.clone();
        Self {
            inputs: Arc::new(UserInputs::new(Box::new(move |pid| started.as_ref().and_then(|feed| feed.process_started(pid))))),
            feed,
        }
    }
}

/// What this thread's admitted input call compares before each press.
struct Watch {
    inputs: Arc<UserInputs>,
    feed: Option<Arc<dyn UserInputFeed>>,
    supervisor: Arc<Supervisor>,
    pid: u32,
    baseline: Baseline,
}

thread_local! {
    static WATCH: RefCell<Option<Watch>> = const { RefCell::new(None) };
}

/// Keeps an admitted request's record watch current on this thread until
/// dropped, together with the press check it installed.
pub(crate) struct AdmitWatch {
    previous: Option<Watch>,
    _press: PressWatch,
}

impl Drop for AdmitWatch {
    fn drop(&mut self) {
        WATCH.with_borrow_mut(|current| *current = self.previous.take());
    }
}

/// Drains `feed` into `inputs`, stamping each press on the supervisor's clock
/// by how long ago the watch saw it.
fn drain(inputs: &UserInputs, feed: Option<&Arc<dyn UserInputFeed>>, supervisor: &Supervisor) {
    let Some(feed) = feed else { return };
    let presses = feed.take();
    let now_ms = supervisor.now_ms();
    let stamped: Vec<(u32, u64)> = presses
        .presses
        .iter()
        .map(|press| {
            let age = u64::try_from(press.at.elapsed().as_millis()).unwrap_or(u64::MAX);
            (press.pid, now_ms.saturating_sub(age))
        })
        .collect();
    // The bounded watch lets its OLDEST presses go, so every dropped press
    // preceded the oldest one kept: stamp them there, never at the drain, and
    // record them first so a kept press stays the app's last one.
    if presses.dropped > 0 {
        let oldest_kept_ms = stamped.iter().map(|(_, at_ms)| *at_ms).min().unwrap_or(now_ms);
        inputs.record_unknown(oldest_kept_ms);
    }
    for (pid, at_ms) in stamped {
        inputs.record(pid, at_ms);
    }
}

/// The press check the backend runs: refuses once the user pressed a key or
/// clicked in the admitted app since admission.
pub(crate) fn check_press() -> CoreResult<()> {
    WATCH.with_borrow(|watch| {
        let Some(watch) = watch else { return Ok(()) };
        drain(&watch.inputs, watch.feed.as_ref(), &watch.supervisor);
        watch.inputs.check(watch.pid, watch.baseline)
    })
}

/// Whether `op` is a read whose success shows the user's input in the window
/// it targets (plan todo 17: capture, captureRegion, observe, ax.snapshot and
/// ax.query on a window). Inspections of single elements, listings, the
/// clipboard, menus and control state only look and clear nothing.
pub(crate) fn window_read(op: &Op) -> Option<&str> {
    let target = match op {
        Op::Capture(params) => &params.target,
        Op::CaptureRegion(params) => &params.target,
        Op::Observe(params) => &params.target,
        Op::AxSnapshot(params) => &params.target,
        Op::AxQuery(params) => &params.target,
        _ => return None,
    };
    match Target::parse(target) {
        Target::Window(_) => Some(target.as_str()),
        Target::Desktop | Target::Display(_) => None,
    }
}

impl Worker {
    /// Takes the backend's feed once its watch runs.
    pub(crate) fn attach_user_input_feed(&mut self) {
        if self.intervention.feed.is_some() {
            return;
        }
        if let Some(feed) = self.backend.as_mut().ok().and_then(|backend| backend.user_input_feed()) {
            self.intervention = Intervention::with_feed(Some(feed));
        }
    }

    pub(crate) fn drain_user_input(&self) {
        drain(&self.intervention.inputs, self.intervention.feed.as_ref(), &self.safety.supervisor);
    }

    fn touch_app(&self, window: &DesktopWindow) -> Option<u32> {
        let pid = window.pid?;
        let started = self.intervention.feed.as_ref().and_then(|feed| feed.process_started(pid));
        self.intervention.inputs.touch(pid, started, || window.app.clone());
        Some(pid)
    }

    /// A read of window `target` that began at `started_ms` reached the
    /// caller: the user's input there is shown if they had paused by then.
    pub(crate) fn note_read(&mut self, target: &str, started_ms: u64) {
        // Without a feed nothing is watched: no window list for the record.
        if self.intervention.feed.is_none() {
            return;
        }
        let Ok(window) = self.window(&Target::parse(target)) else { return };
        if let Some(pid) = self.touch_app(&window) {
            self.intervention.inputs.read(pid, started_ms);
        }
    }

    /// Admits `mutation` to the app its target names: waits for the user to
    /// pause when they used it since the last read, refuses `UserIntervened`
    /// without sending, and installs the press check for the request. A
    /// mutation that names no app (the clipboard, an unknown window) is
    /// admitted at once with no check.
    pub(crate) fn admit_intervention(
        &mut self,
        mutation: &Mutation<'_>,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<AdmitWatch> {
        let unwatched = || AdmitWatch { previous: WATCH.with_borrow_mut(Option::take), _press: watch(check_press) };
        // Without a feed (no watch on this backend, or the macOS watch Off or
        // NotStarted) nothing is watched and nothing changes: no window list,
        // no wait. The clipboard is never admitted against an app.
        if mutation.action == MutatingAction::ClipboardWrite || self.intervention.feed.is_none() {
            return Ok(unwatched());
        }
        // A failing window list is the request's own failure; a target the list
        // does not name (an unknown window, no focused window) is nobody's app.
        let windows = self.backend()?.windows()?;
        let window = match Target::parse(&mutation.target) {
            Target::Window(id) => windows.into_iter().find(|window| window.id == id),
            Target::Desktop | Target::Display(_) => windows.into_iter().find(|window| window.focused),
        };
        let Some(window) = window else {
            return Ok(unwatched());
        };
        // Presses up to now are drained before the app is watched, so a press
        // that landed during the window list is the user's own, not a reason to
        // refuse an app the session had not touched yet.
        self.drain_user_input();
        let Some(pid) = self.touch_app(&window) else {
            return Ok(unwatched());
        };
        let supervisor = Arc::clone(&self.safety.supervisor);
        let policy = self.stop_policy();
        let inputs = Arc::clone(&self.intervention.inputs);
        let feed = self.intervention.feed.clone();
        let wait = |ms: u64| -> CoreResult<()> {
            let until = Instant::now() + Duration::from_millis(ms);
            loop {
                let is_cancelled = cancelled();
                if let Some(stopped) = crate::mutate::interruption(&supervisor, &policy) {
                    return Err(stopped);
                }
                if is_cancelled {
                    return Err(DesktopError::new(
                        ErrorCode::Cancelled,
                        "the request was cancelled while waiting for the user to pause; nothing was sent",
                    ));
                }
                let left = until.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    return Ok(());
                }
                std::thread::sleep(left.min(WAIT_SLICE));
                drain(&inputs, feed.as_ref(), &supervisor);
            }
        };
        let baseline = inputs.admit(pid, None, || supervisor.now_ms(), wait)?;
        let previous = WATCH.with_borrow_mut(|current| {
            current.replace(Watch { inputs: Arc::clone(&inputs), feed, supervisor: Arc::clone(&supervisor), pid, baseline })
        });
        Ok(AdmitWatch { previous, _press: watch(check_press) })
    }
}

#[cfg(test)]
mod tests;
