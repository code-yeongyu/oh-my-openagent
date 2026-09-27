//! The X11 `Global` stop path: on the dedicated `senpi-desktop-killswitch`
//! thread an XI2 raw-key listener (its own x11rb connection) latches the
//! supervisor when the stop chord goes down, and beats every 500 ms while a
//! heartbeat round trip on that connection succeeds. Raw events are
//! preferred over `XGrabKey`: they see the chord whichever client has focus
//! or a grab, and never steal the keys from anyone.
//!
//! A connection that breaks marks the path not live (input refused); the
//! listener then parks until [`StopPathListener::restart`] reconnects it.

mod chord;
mod xi2;

#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::{Condvar, Mutex};
use senpi_desktop_safety::{
    Chord, StopPathError, StopPathId, StopPathListener, StopSource, Supervisor, HEARTBEAT_INTERVAL_MS,
};

use chord::Hotkey;
pub use chord::DEFAULT_STOP_CHORD;

const THREAD_NAME: &str = "senpi-desktop-killswitch";
const THREAD_UNAVAILABLE: &str = "killswitch-thread-unavailable";
/// How long `start()` waits for the XI2 connection to go live.
const START_TIMEOUT: Duration = Duration::from_secs(2);
const HEARTBEAT: Duration = Duration::from_millis(HEARTBEAT_INTERVAL_MS);

/// State the listener thread shares with its owner.
#[derive(Debug, Default)]
struct Control {
    live: bool,
    /// Connections that failed to open, and the last one's reason.
    failures: u64,
    failure: Option<String>,
    /// Stops this listener latched.
    stops: u64,
    restart: bool,
    shutdown: bool,
}

struct Shared {
    supervisor: Arc<Supervisor>,
    hotkey: Mutex<Hotkey>,
    control: Mutex<Control>,
    changed: Condvar,
}

impl Shared {
    fn update(&self, change: impl FnOnce(&mut Control)) {
        change(&mut self.control.lock());
        self.changed.notify_all();
    }

    fn set_live(&self, live: bool) {
        self.supervisor.set_live(StopPathId::Global, live);
        self.update(|control| control.live = live);
    }

    fn open_failed(&self, reason: &str) {
        self.supervisor.set_live(StopPathId::Global, false);
        self.update(|control| {
            control.live = false;
            control.failures = control.failures.saturating_add(1);
            control.failure = Some(reason.to_owned());
        });
    }

    fn heartbeat(&self) {
        self.supervisor.heartbeat(StopPathId::Global);
    }

    fn chord_pressed(&self) {
        self.supervisor.trigger_stop(StopSource::Hotkey);
        self.update(|control| control.stops = control.stops.saturating_add(1));
    }

    /// Waits up to `timeout`; `true` once shutdown is requested.
    fn wait_shutdown(&self, timeout: Duration) -> bool {
        let mut control = self.control.lock();
        self.changed
            .wait_while_for(&mut control, |control| !control.shutdown, timeout);
        control.shutdown
    }

    /// Asks a listener that is not live to reconnect.
    fn request_restart(&self) {
        self.update(|control| control.restart = !control.live);
    }

    /// Parks until a restart (`true`) or shutdown (`false`) request.
    fn wait_restart(&self) -> bool {
        let mut control = self.control.lock();
        self.changed
            .wait_while(&mut control, |control| !control.restart && !control.shutdown);
        control.restart = false;
        !control.shutdown
    }

    /// Waits until live, a connection failure beyond `failures`, or
    /// `timeout`.
    fn wait_live(&self, failures: u64, timeout: Duration) -> Result<(), StopPathError> {
        let mut control = self.control.lock();
        self.changed.wait_while_for(
            &mut control,
            |control| !control.live && control.failures == failures && !control.shutdown,
            timeout,
        );
        if control.live {
            return Ok(());
        }
        Err(StopPathError::Unavailable {
            reason: control
                .failure
                .clone()
                .unwrap_or_else(|| xi2::CONNECTION_FAILED.to_owned()),
        })
    }
}

fn run_listener(shared: &Shared) {
    loop {
        let hotkey = shared.hotkey.lock().clone();
        match xi2::run(shared, &hotkey) {
            xi2::Run::Shutdown => return,
            xi2::Run::Died | xi2::Run::OpenFailed => {}
        }
        if !shared.wait_restart() {
            return;
        }
    }
}

/// The XI2 raw-key kill switch; one listener thread per instance, stopped
/// when the instance drops.
#[derive(Default)]
pub struct Xi2Listener {
    shared: Option<Arc<Shared>>,
}

impl Xi2Listener {
    #[must_use]
    pub const fn new() -> Self {
        Self { shared: None }
    }
}

impl StopPathListener for Xi2Listener {
    /// Idempotent: a later call replaces the chord (the running connection
    /// matches the new one from its next key press) and reconnects a
    /// listener that is not live; the thread keeps its first supervisor.
    fn start(&mut self, chord: &Chord, sup: Arc<Supervisor>) -> Result<(), StopPathError> {
        let hotkey = Hotkey::parse(chord)?;
        let (shared, failures) = if let Some(shared) = &self.shared {
            *shared.hotkey.lock() = hotkey;
            let failures = shared.control.lock().failures;
            shared.request_restart();
            (Arc::clone(shared), failures)
        } else {
            let shared = Arc::new(Shared {
                supervisor: sup,
                hotkey: Mutex::new(hotkey),
                control: Mutex::new(Control::default()),
                changed: Condvar::new(),
            });
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
        shared.wait_live(failures, START_TIMEOUT)
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

impl Drop for Xi2Listener {
    fn drop(&mut self) {
        if let Some(shared) = &self.shared {
            shared.update(|control| control.shutdown = true);
        }
    }
}
