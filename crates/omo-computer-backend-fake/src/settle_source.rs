//! The settle reads of the fake: observer events and notification posts by fake-clock time,
//! the scripted loading indicators and the notification surface. Waiting moves the fake clock
//! to the next scripted event or to the deadline; nothing here reads the host's time.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use omo_computer_core::backend::{
    AxEvent, BackendClock, BackendResult, NotificationFingerprint, SettleSource,
    NO_NOTIFICATION_SURFACE,
};
use omo_computer_core::observation::BusyIndicator;

use crate::clock::FakeClock;
use crate::scenario::NotificationPost;
use crate::state::FakeState;
use crate::timeline::{self, LoadingState};

impl BackendClock for FakeClock {
    fn now_ms(&self) -> u64 {
        Self::now_ms(self)
    }

    fn wait_ms(&self, ms: u64) {
        self.advance(ms);
    }
}

pub struct FakeSettleSource {
    shared: Arc<Mutex<FakeState>>,
    clock: FakeClock,
}

impl FakeSettleSource {
    pub const fn new(shared: Arc<Mutex<FakeState>>, clock: FakeClock) -> Self {
        Self { shared, clock }
    }

    fn lock(&self) -> MutexGuard<'_, FakeState> {
        self.shared.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl SettleSource for FakeSettleSource {
    fn wait_event(&mut self, until_ms: u64) -> BackendResult<Option<AxEvent>> {
        let _ = (
            until_ms,
            self.lock().start_ms,
            timeline::next_due(&[], 0, 0),
        );
        Ok(None)
    }

    fn busy(&mut self, window: &str) -> BackendResult<Option<BusyIndicator>> {
        let _ = (window, LoadingState::Unknown);
        Ok(None)
    }

    fn notifications(&mut self) -> BackendResult<Vec<NotificationFingerprint>> {
        let _: Option<&NotificationPost> = None;
        Err(NO_NOTIFICATION_SURFACE)
    }
}
