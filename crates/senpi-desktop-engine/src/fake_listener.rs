//! `SENPI_DESKTOP_FAKE_STOP_PATH=live`: a Global stop listener for the fake
//! backend that is live once started and never fires, so a fake `--serve`
//! daemon has the global stop path a real OS listener would give it. Like the
//! real listeners it heartbeats every `HEARTBEAT_INTERVAL_MS`; a path whose
//! last beat is older than `HEARTBEAT_FRESH_MS` stops admitting input.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use senpi_desktop_safety::{
    Chord, StopPathError, StopPathId, StopPathListener, Supervisor, HEARTBEAT_INTERVAL_MS,
};

pub const FAKE_STOP_PATH_ENV: &str = "SENPI_DESKTOP_FAKE_STOP_PATH";

#[derive(Default)]
pub struct FakeGlobalListener {
    beating: Option<Arc<AtomicBool>>,
}

impl FakeGlobalListener {
    pub fn from_env() -> Option<Self> {
        (std::env::var(FAKE_STOP_PATH_ENV).as_deref() == Ok("live")).then(Self::default)
    }
}

impl StopPathListener for FakeGlobalListener {
    fn start(&mut self, _chord: &Chord, sup: Arc<Supervisor>) -> Result<(), StopPathError> {
        sup.set_live(StopPathId::Global, true);
        let beating = Arc::new(AtomicBool::new(true));
        let running = Arc::clone(&beating);
        thread::Builder::new()
            .name("fake-stop-path-heartbeat".to_owned())
            .spawn(move || {
                while running.load(Ordering::Acquire) {
                    sup.heartbeat(StopPathId::Global);
                    thread::sleep(Duration::from_millis(HEARTBEAT_INTERVAL_MS));
                }
            })
            .map_err(|_| StopPathError::Unavailable {
                reason: "fake-heartbeat-thread-unavailable".to_owned(),
            })?;
        self.beating = Some(beating);
        Ok(())
    }

    fn is_live(&self) -> bool {
        self.beating.is_some()
    }

    fn restart(&mut self) {}
}

impl Drop for FakeGlobalListener {
    fn drop(&mut self) {
        if let Some(beating) = &self.beating {
            beating.store(false, Ordering::Release);
        }
    }
}
