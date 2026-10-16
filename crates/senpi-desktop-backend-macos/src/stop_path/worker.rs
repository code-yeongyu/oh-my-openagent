//! The tap only sets atomic flags and unparks this prestarted worker.
use super::{Control, tap};
use parking_lot::{Condvar, Mutex};
use senpi_desktop_safety::{StopPathError, StopSource, Supervisor};
use std::sync::{
    Arc,
    atomic::{AtomicU8, Ordering},
};
use std::thread::{self, JoinHandle};

const STOP: u8 = 1;
const TIMEOUT_RECOVERY: u8 = 2;
const USER_RECOVERY: u8 = 4;
const SHUTDOWN: u8 = 8;

pub(super) struct StopWorker {
    supervisor: Arc<Supervisor>,
    pending: Arc<AtomicU8>,
    thread: Option<JoinHandle<()>>,
}

impl StopWorker {
    pub(super) fn start(
        supervisor: Arc<Supervisor>,
        control: Arc<Mutex<Control>>,
        changed: Arc<Condvar>,
    ) -> Result<Self, StopPathError> {
        let pending = Arc::new(AtomicU8::new(0));
        let work = Arc::clone(&pending);
        let stopping = Arc::clone(&supervisor);
        let thread = thread::Builder::new().name("senpi-desktop-stop-commit".to_owned())
            .spawn(move || loop {
                let flags = work.swap(0, Ordering::SeqCst);
                if flags & STOP != 0 {
                    stopping.trigger_stop(StopSource::Hotkey);
                    {
                        let mut control = control.lock();
                        control.stops = control.stops.saturating_add(1);
                    }
                    changed.notify_all();
                }
                for (flag, event_type) in [
                    (TIMEOUT_RECOVERY, tap::TAP_DISABLED_BY_TIMEOUT),
                    (USER_RECOVERY, tap::TAP_DISABLED_BY_USER_INPUT),
                ] {
                    if flags & flag != 0 {
                        eprintln!("senpi-desktop: re-enabled disabled event tap event_type={event_type}");
                        #[cfg(test)]
                        {
                            control.lock().hooks.reenabled.push(event_type);
                            changed.notify_all();
                        }
                    }
                }
                if flags & SHUTDOWN != 0 { break; }
                thread::park();
            })
            .map_err(|_| StopPathError::Unavailable {
                reason: "stop-commit-thread-unavailable".to_owned(),
            })?;
        Ok(Self {
            supervisor,
            pending,
            thread: Some(thread),
        })
    }

    pub(super) fn stop(&self) {
        self.supervisor.suspend_input();
        self.notify(STOP);
    }

    pub(super) fn reenabled(&self, event_type: u32) {
        self.notify(if event_type == tap::TAP_DISABLED_BY_TIMEOUT {
            TIMEOUT_RECOVERY
        } else {
            USER_RECOVERY
        });
    }

    fn notify(&self, flag: u8) {
        self.pending.fetch_or(flag, Ordering::SeqCst);
        if let Some(worker) = &self.thread {
            worker.thread().unpark();
        }
    }
}

impl Drop for StopWorker {
    fn drop(&mut self) {
        self.notify(SHUTDOWN);
        if let Some(worker) = self.thread.take() {
            if worker.join().is_err() {
                eprintln!("senpi-desktop: stop commit worker panicked");
            }
        }
    }
}
