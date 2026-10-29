//! Scriptable observer around the real fake backend's input delivery.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_core::background_action::{BackgroundActionState, BackgroundActionWatch};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::key_reroute::audit::{AuditLease, AuditSink};

#[derive(Clone, Default)]
pub(crate) struct BackgroundFixture {
    pub(crate) state: Arc<Mutex<Option<Arc<BackgroundActionState>>>>,
    pub(crate) begins: Arc<AtomicUsize>,
    pub(crate) finishes: Arc<AtomicUsize>,
    pub(crate) drops: Arc<AtomicUsize>,
    pub(crate) finish_error: Arc<Mutex<Option<DesktopError>>>,
    pub(crate) visit_on_finish: Arc<AtomicBool>,
    pub(crate) arm_reroute: Arc<AtomicBool>,
    pub(crate) reroute: Arc<Mutex<Option<AuditLease>>>,
}

impl BackgroundFixture {
    pub(crate) fn begin(&self, audit: AuditSink) -> Option<Box<dyn BackgroundActionWatch>> {
        let state = self.state.lock().clone()?;
        self.begins.fetch_add(1, Ordering::SeqCst);
        if self.arm_reroute.load(Ordering::SeqCst) {
            *self.reroute.lock() = Some(AuditLease::arm(1, audit));
        }
        Some(Box::new(Watch {
            fixture: self.clone(),
            state,
        }))
    }
}

struct Watch {
    fixture: BackgroundFixture,
    state: Arc<BackgroundActionState>,
}

impl BackgroundActionWatch for Watch {
    fn state(&self) -> Arc<BackgroundActionState> {
        Arc::clone(&self.state)
    }

    fn finish(&mut self) -> CoreResult<()> {
        self.fixture.finishes.fetch_add(1, Ordering::SeqCst);
        if self.fixture.visit_on_finish.load(Ordering::SeqCst) {
            let now = std::time::Instant::now();
            let mut lease = self.state.lease.lock();
            let target = lease.target;
            lease.observe(
                target,
                None,
                senpi_desktop_core::background_focus::SwitchSignals {
                    buttons: [1, 0, 0, 0, 0, 0],
                    last_click: Some(now),
                    ..Default::default()
                },
                now,
            );
        }
        self.fixture.finish_error.lock().take().map_or(Ok(()), Err)
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        self.fixture.drops.fetch_add(1, Ordering::SeqCst);
    }
}
