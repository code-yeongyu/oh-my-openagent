//! The macOS `Global` stop path, ported from gajae-code
//! `pi-natives/src/computer/hotkey.rs`: a listen-only `CGEventTap` on the
//! dedicated `senpi-desktop-killswitch` thread latches the supervisor when
//! the stop chord goes down and beats every 500 ms while the tap is enabled.
//!
//! Re-arm (AD-4): the callback re-enables a tap the OS disabled; a tap that
//! dies or stays disabled marks the path not live (input refused) and is
//! re-created after 250 ms, 500 ms, 1 s, 2 s, 4 s, then the listener parks
//! until [`StopPathListener::restart`] resets the ladder.

mod chord;
mod tap;

#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::{Condvar, Mutex};
use senpi_desktop_safety::{Chord, StopPathError, StopPathId, StopPathListener, StopSource, Supervisor};

use chord::Hotkey;
pub use chord::DEFAULT_STOP_CHORD;

const THREAD_NAME: &str = "senpi-desktop-killswitch";
/// How long `start()` waits for the first tap to go live.
const START_TIMEOUT: Duration = Duration::from_secs(1);
/// Delays before each re-creation of a dead tap.
const RE_ARM_LADDER_MS: [u64; 5] = [250, 500, 1_000, 2_000, 4_000];
const ACCESSIBILITY_REQUIRED: &str =
    "macOS Accessibility permission is not granted for this process; the kill-switch event tap needs it";
/// `stopReason` when the tap could not be created although trusted.
const TAP_UNAVAILABLE: &str = "event-tap-unavailable";
const THREAD_UNAVAILABLE: &str = "event-tap-thread-unavailable";

/// Position on the re-arm ladder.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct Ladder {
    tries: usize,
}

impl Ladder {
    /// The wait before the next re-creation; `None` once every rung ran.
    fn next_delay(&mut self) -> Option<Duration> {
        let delay = RE_ARM_LADDER_MS
            .get(self.tries)
            .copied()
            .map(Duration::from_millis);
        self.tries = self.tries.saturating_add(1);
        delay
    }
}

/// State the listener thread shares with its owner and the tap callback.
#[derive(Debug, Default)]
struct Control {
    live: bool,
    /// Taps that failed to come up; lets `start()` stop waiting early.
    failures: u64,
    /// Stops this listener latched.
    stops: u64,
    restart: bool,
    shutdown: bool,
    #[cfg(test)]
    hooks: tap::TestHooks,
}

/// Why the parked listener thread woke up.
#[derive(Debug, PartialEq, Eq)]
enum Wake {
    Retry,
    Restart,
    Shutdown,
}

struct Shared {
    supervisor: Arc<Supervisor>,
    hotkey: Mutex<Hotkey>,
    control: Mutex<Control>,
    changed: Condvar,
}

impl Shared {
    fn new(supervisor: Arc<Supervisor>, hotkey: Hotkey) -> Self {
        Self {
            supervisor,
            hotkey: Mutex::new(hotkey),
            control: Mutex::new(Control::default()),
            changed: Condvar::new(),
        }
    }

    fn update(&self, change: impl FnOnce(&mut Control)) {
        change(&mut self.control.lock());
        self.changed.notify_all();
    }

    fn set_live(&self, live: bool) {
        self.supervisor.set_live(StopPathId::Global, live);
        self.update(|control| {
            control.live = live;
            #[cfg(test)]
            {
                control.hooks.went_live += u64::from(live);
            }
        });
    }

    fn tap_failed(&self) {
        self.supervisor.set_live(StopPathId::Global, false);
        self.update(|control| {
            control.live = false;
            control.failures = control.failures.saturating_add(1);
        });
    }

    fn heartbeat(&self) {
        self.supervisor.heartbeat(StopPathId::Global);
    }

    /// The tap saw a key-down; latches a stop when it is the chord.
    fn key_down(&self, keycode: i64, flags: u64) {
        if self.hotkey.lock().matches_hotkey(keycode, flags) {
            self.supervisor.trigger_stop(StopSource::Hotkey);
            self.update(|control| control.stops = control.stops.saturating_add(1));
        }
    }

    fn shutdown_requested(&self) -> bool {
        self.control.lock().shutdown
    }

    /// Resets the ladder of a listener that is not live.
    fn request_restart(&self) {
        self.update(|control| control.restart = !control.live);
    }

    /// Parks the thread for `delay` (forever when `None`) or until a
    /// restart or shutdown request.
    fn wait_to_retry(&self, delay: Option<Duration>) -> Wake {
        let mut control = self.control.lock();
        let idle = |control: &mut Control| !control.restart && !control.shutdown;
        match delay {
            Some(delay) => {
                self.changed.wait_while_for(&mut control, idle, delay);
            }
            None => self.changed.wait_while(&mut control, idle),
        }
        if control.shutdown {
            Wake::Shutdown
        } else if std::mem::take(&mut control.restart) {
            Wake::Restart
        } else {
            Wake::Retry
        }
    }

    /// Waits until the tap is live, a tap failure beyond `failures` is
    /// recorded, or `timeout` passes; returns liveness.
    fn wait_live(&self, failures: u64, timeout: Duration) -> bool {
        let mut control = self.control.lock();
        self.changed.wait_while_for(
            &mut control,
            |control| !control.live && control.failures == failures && !control.shutdown,
            timeout,
        );
        control.live
    }
}

fn run_listener(shared: &Shared) {
    let mut ladder = Ladder::default();
    loop {
        match tap::run(shared) {
            tap::TapRun::Shutdown => return,
            tap::TapRun::Died => ladder = Ladder::default(),
            tap::TapRun::CreateFailed => {}
        }
        match shared.wait_to_retry(ladder.next_delay()) {
            Wake::Shutdown => return,
            Wake::Restart => ladder = Ladder::default(),
            Wake::Retry => {}
        }
    }
}

/// The `CGEventTap` kill switch; one listener thread per instance, stopped
/// when the instance drops.
#[derive(Default)]
pub struct CgEventTapListener {
    shared: Option<Arc<Shared>>,
}

impl CgEventTapListener {
    #[must_use]
    pub const fn new() -> Self {
        Self { shared: None }
    }
}

impl StopPathListener for CgEventTapListener {
    /// Idempotent: a later call updates the chord and resets the re-arm
    /// ladder of the running thread, which keeps its first supervisor.
    fn start(&mut self, chord: &Chord, sup: Arc<Supervisor>) -> Result<(), StopPathError> {
        let hotkey = Hotkey::parse(chord)?;
        if !crate::ax::is_trusted() {
            return Err(StopPathError::PermissionDenied(ACCESSIBILITY_REQUIRED.to_owned()));
        }
        let (shared, failures) = if let Some(shared) = &self.shared {
            *shared.hotkey.lock() = hotkey;
            let failures = shared.control.lock().failures;
            shared.request_restart();
            (Arc::clone(shared), failures)
        } else {
            let shared = Arc::new(Shared::new(sup, hotkey));
            let listener = Arc::clone(&shared);
            thread::Builder::new()
                .name(THREAD_NAME.to_owned())
                .spawn(move || run_listener(&listener))
                .map_err(|_| StopPathError::Unavailable {
                    reason: THREAD_UNAVAILABLE.to_owned(),
                })?;
            self.shared = Some(Arc::clone(&shared));
            (shared, 0)
        };
        if shared.wait_live(failures, START_TIMEOUT) {
            Ok(())
        } else {
            Err(StopPathError::Unavailable {
                reason: TAP_UNAVAILABLE.to_owned(),
            })
        }
    }

    fn is_live(&self) -> bool {
        self.shared
            .as_ref()
            .is_some_and(|shared| shared.control.lock().live)
    }

    fn restart(&mut self) {
        if let Some(shared) = &self.shared {
            shared.request_restart();
        }
    }
}

impl Drop for CgEventTapListener {
    fn drop(&mut self) {
        if let Some(shared) = &self.shared {
            shared.update(|control| control.shutdown = true);
        }
    }
}
