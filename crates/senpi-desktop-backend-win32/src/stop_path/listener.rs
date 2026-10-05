//! `HotkeyListener`: the owner side of the kill-switch thread and the state
//! both sides share.

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::{Condvar, Mutex};
use senpi_desktop_safety::{Chord, StopPathError, StopPathId, StopPathListener, StopSource, Supervisor};

use super::chord::Hotkey;
use super::hotkey::{self, Run};

const THREAD_NAME: &str = "senpi-desktop-killswitch";
const THREAD_UNAVAILABLE: &str = "killswitch-thread-unavailable";
/// How long `start()` waits for the registration to settle.
const START_TIMEOUT: Duration = Duration::from_secs(2);

/// State the listener thread shares with its owner.
#[derive(Debug, Default)]
pub(super) struct Control {
    pub(super) live: bool,
    /// Registration attempts that settled (registered or refused).
    pub(super) attempts: u64,
    /// Why the last attempt was refused.
    pub(super) failure: Option<String>,
    /// Stops this listener latched.
    pub(super) stops: u64,
    /// The listener thread's id, once its message queue exists.
    pub(super) thread_id: Option<u32>,
    /// Re-register (the chord changed, or a refused one should retry).
    pub(super) restart: bool,
    pub(super) shutdown: bool,
}

pub(super) struct Shared {
    supervisor: Arc<Supervisor>,
    pub(super) hotkey: Mutex<Hotkey>,
    pub(super) control: Mutex<Control>,
    pub(super) changed: Condvar,
}

impl Shared {
    pub(super) fn update(&self, change: impl FnOnce(&mut Control)) {
        change(&mut self.control.lock());
        self.changed.notify_all();
    }

    /// Records a settled registration attempt; `failure` is its refusal.
    pub(super) fn settled(&self, failure: Option<&str>) {
        let live = failure.is_none();
        self.supervisor.set_live(StopPathId::Global, live);
        self.update(|control| {
            control.live = live;
            control.attempts = control.attempts.saturating_add(1);
            control.failure = failure.map(str::to_owned);
        });
    }

    pub(super) fn unregistered(&self) {
        self.supervisor.set_live(StopPathId::Global, false);
        self.update(|control| control.live = false);
    }

    pub(super) fn heartbeat(&self) {
        self.supervisor.heartbeat(StopPathId::Global);
    }

    pub(super) fn chord_pressed(&self) {
        self.supervisor.trigger_stop(StopSource::Hotkey);
        self.update(|control| control.stops = control.stops.saturating_add(1));
    }

    /// Asks the thread to re-register; `force` also re-registers a live one.
    fn request_restart(&self, force: bool) {
        let mut control = self.control.lock();
        control.restart = force || !control.live;
        let thread_id = control.thread_id;
        drop(control);
        self.changed.notify_all();
        hotkey::wake(thread_id);
    }

    /// Parks until a restart (`true`) or shutdown (`false`) request.
    fn wait_restart(&self) -> bool {
        let mut control = self.control.lock();
        self.changed
            .wait_while(&mut control, |control| !control.restart && !control.shutdown);
        control.restart = false;
        !control.shutdown
    }

    /// Waits until an attempt beyond `attempts` settles, or `timeout`.
    fn wait_settled(&self, attempts: u64, timeout: Duration) -> Result<(), StopPathError> {
        let mut control = self.control.lock();
        self.changed.wait_while_for(
            &mut control,
            |control| control.attempts == attempts && !control.shutdown,
            timeout,
        );
        if control.live {
            return Ok(());
        }
        Err(StopPathError::Unavailable {
            reason: control
                .failure
                .clone()
                .unwrap_or_else(|| hotkey::REGISTRATION_FAILED.to_owned()),
        })
    }
}

fn run_listener(shared: &Shared) {
    hotkey::create_queue(shared);
    loop {
        let chord = *shared.hotkey.lock();
        match hotkey::run(shared, chord) {
            Run::Shutdown => return,
            Run::Restart => {}
            Run::Refused | Run::Died => {
                if !shared.wait_restart() {
                    return;
                }
            }
        }
    }
}

/// The `RegisterHotKey` kill switch; one listener thread per instance,
/// stopped when the instance drops.
#[derive(Default)]
pub struct HotkeyListener {
    pub(super) shared: Option<Arc<Shared>>,
}

impl HotkeyListener {
    #[must_use]
    pub const fn new() -> Self {
        Self { shared: None }
    }
}

impl StopPathListener for HotkeyListener {
    /// Idempotent: a later call replaces the chord and re-registers it; the
    /// thread keeps its first supervisor.
    fn start(&mut self, chord: &Chord, sup: Arc<Supervisor>) -> Result<(), StopPathError> {
        let hotkey = Hotkey::parse(chord)?;
        if let Some(shared) = &self.shared {
            *shared.hotkey.lock() = hotkey;
            let attempts = shared.control.lock().attempts;
            shared.request_restart(true);
            return shared.wait_settled(attempts, START_TIMEOUT);
        }
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
        shared.wait_settled(0, START_TIMEOUT)
    }

    fn is_live(&self) -> bool {
        self.shared
            .as_ref()
            .is_some_and(|shared| shared.control.lock().live)
    }

    fn restart(&mut self) {
        if let Some(shared) = &self.shared {
            shared.request_restart(false);
        }
    }
}

impl Drop for HotkeyListener {
    fn drop(&mut self) {
        if let Some(shared) = &self.shared {
            shared.update(|control| control.shutdown = true);
            hotkey::wake(shared.control.lock().thread_id);
        }
    }
}
