//! The user's own key presses and clicks, per app: a listen-only event tap at
//! the annotated session tap, where WindowServer names the process each event
//! lands in, recording every press the engine did not post (D3). Ported from
//! oh-my-pi `desktop/control/macos.rs` (`UserInputMonitor`, MIT). The stop
//! chord keeps its own tap in `stop_path`, untouched (D6).

mod ffi;
mod tap;

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;

use parking_lot::Mutex;
use senpi_desktop_core::types::InterventionWatch;
use senpi_desktop_core::user_input::{UserInputFeed, UserPress, UserPressKind, UserPresses};

use super::cgevent::ENGINE_EVENT_TAG;

const LEFT_MOUSE_DOWN: u32 = 1;
const RIGHT_MOUSE_DOWN: u32 = 3;
const KEY_DOWN: u32 = 10;
const OTHER_MOUSE_DOWN: u32 = 25;

/// The event types the watch listens to: key presses and every pointer press.
const USER_INPUT_MASK: u64 =
    (1 << KEY_DOWN) | (1 << LEFT_MOUSE_DOWN) | (1 << RIGHT_MOUSE_DOWN) | (1 << OTHER_MOUSE_DOWN);

/// Presses kept until read; older ones are counted as dropped.
const LOG_CAPACITY: usize = 256;

/// Whether an event came from someone other than the engine: the user's
/// hardware, or a tool such as dictation posting for them under its own pid.
const fn foreign(tag: i64, source_pid: i64, own_pid: i64) -> bool {
    tag != ENGINE_EVENT_TAG && source_pid != own_pid
}

/// Where a foreign event lands when the annotated tap names no target.
enum Untargeted {
    /// The front process, which takes the keyboard.
    Front,
    /// Nowhere: a click without a target names no app.
    Dropped,
}

/// The rule for each type the watch listens to; `None` for a type without one.
const fn untargeted(kind: u32) -> Option<Untargeted> {
    match kind {
        KEY_DOWN => Some(Untargeted::Front),
        LEFT_MOUSE_DOWN | RIGHT_MOUSE_DOWN | OTHER_MOUSE_DOWN => Some(Untargeted::Dropped),
        _ => None,
    }
}

// A type added to `USER_INPUT_MASK` fails the build until it has a rule.
const _: () = {
    let mut kind = 0;
    while kind < 64 {
        assert!(
            USER_INPUT_MASK & (1 << kind) == 0 || untargeted(kind).is_some(),
            "a user-input type has no rule"
        );
        kind += 1;
    }
};

/// The process a foreign key press or click lands in: the target the
/// annotated tap names, else what [`untargeted`] says for its type, and the
/// front process for a type without a rule (at worst the agent reads that app
/// again, where dropping it would let the agent act on what the user changed).
fn input_target(
    kind: u32,
    target: i64,
    front: impl FnOnce() -> Option<libc::pid_t>,
) -> Option<libc::pid_t> {
    if let Ok(pid @ 1..) = libc::pid_t::try_from(target) {
        return Some(pid);
    }
    match untargeted(kind) {
        Some(Untargeted::Front) | None => front(),
        Some(Untargeted::Dropped) => None,
    }
}

const fn press_kind(kind: u32) -> UserPressKind {
    if kind == KEY_DOWN {
        UserPressKind::Key
    } else {
        UserPressKind::Click
    }
}

#[derive(Debug, Clone, Copy)]
struct Heard {
    /// `kCGEventSourceUserData`.
    tag: i64,
    /// `kCGEventSourceUnixProcessID`: 0 for hardware input.
    source_pid: i64,
    /// `kCGEventTargetUnixProcessID`, filled in at the annotated tap.
    target: i64,
}

/// The presses the tap thread recorded, read by the session worker. The tap
/// callback only takes this short lock to push.
#[derive(Default)]
struct UserInputLog(Mutex<LogState>);

#[derive(Default)]
struct LogState {
    presses: VecDeque<UserPress>,
    dropped: u64,
}

impl UserInputLog {
    /// Records one event the tap heard, unless the engine posted it or it
    /// names no app.
    fn observe(
        &self,
        kind: u32,
        heard: Heard,
        own_pid: i64,
        front: impl FnOnce() -> Option<libc::pid_t>,
    ) {
        if !foreign(heard.tag, heard.source_pid, own_pid) {
            return;
        }
        let Some(pid) =
            input_target(kind, heard.target, front).and_then(|pid| u32::try_from(pid).ok())
        else {
            return;
        };
        self.record(UserPress {
            pid,
            kind: press_kind(kind),
            at: Instant::now(),
        });
    }

    fn record(&self, press: UserPress) {
        let mut state = self.0.lock();
        if state.presses.len() == LOG_CAPACITY {
            state.presses.pop_front();
            state.dropped += 1;
        }
        state.presses.push_back(press);
    }

    fn take(&self) -> UserPresses {
        let mut state = self.0.lock();
        UserPresses {
            presses: state.presses.drain(..).collect(),
            dropped: std::mem::take(&mut state.dropped),
        }
    }
}

/// The backend's watch: started on demand, stopped when dropped (session
/// close or a new backend). Without Accessibility trust, or when macOS
/// refuses the tap, it stays off for this backend: nothing is watched,
/// background input is not held back for it (D6), and it is not retried.
#[derive(Default)]
pub(crate) struct UserInputWatch(Watch);

#[derive(Default)]
enum Watch {
    #[default]
    NotStarted,
    On {
        log: Arc<UserInputLog>,
        _monitor: tap::Monitor,
    },
    Off,
}

impl UserInputWatch {
    /// Starts the tap once; later calls keep whatever the first one got.
    pub(crate) fn start(&mut self) {
        self.start_with(crate::ax::is_trusted, tap::Monitor::start);
    }

    /// A key-listening tap created without Accessibility trust can raise a
    /// new macOS privacy prompt, so trust is checked first without prompting,
    /// as the stop-chord tap does.
    fn start_with(
        &mut self,
        trusted: impl FnOnce() -> bool,
        tap: impl FnOnce(Arc<UserInputLog>) -> Option<tap::Monitor>,
    ) {
        if !matches!(self.0, Watch::NotStarted) {
            return;
        }
        if !trusted() {
            self.0 = Watch::Off;
            return;
        }
        let log = Arc::new(UserInputLog::default());
        self.0 = match tap(Arc::clone(&log)) {
            Some(monitor) => Watch::On {
                log,
                _monitor: monitor,
            },
            None => Watch::Off,
        };
    }

    pub(crate) fn state(&self) -> InterventionWatch {
        match &self.0 {
            Watch::NotStarted => InterventionWatch::NotStarted,
            Watch::On { .. } => InterventionWatch::On,
            Watch::Off => InterventionWatch::Off,
        }
    }

    pub(crate) fn take(&self) -> UserPresses {
        match &self.0 {
            Watch::On { log, .. } => log.take(),
            Watch::NotStarted | Watch::Off => UserPresses::default(),
        }
    }

    /// The running watch's log as the session's feed; `None` while off.
    pub(crate) fn feed(&self) -> Option<Arc<dyn UserInputFeed>> {
        match &self.0 {
            Watch::On { log, .. } => Some(Arc::new(feed::Feed(Arc::clone(log)))),
            Watch::NotStarted | Watch::Off => None,
        }
    }
}

mod feed;

#[cfg(test)]
#[path = "user_monitor/tests.rs"]
mod tests;
