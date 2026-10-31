//! A fake power assertion (IOPM) that counts its holds, and a fake screen
//! whose lock and sleep state the test sets.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use senpi_desktop_core::backend::{DisplayAwakeHold, ScreenProbe};
use senpi_desktop_core::types::{DisplaySelector, ScreenState};

#[derive(Clone, Default)]
pub(crate) struct AwakeHolds(Arc<Counts>);

#[derive(Default)]
struct Counts {
    taken: AtomicUsize,
    released: AtomicUsize,
}

struct Held(Arc<Counts>);

impl Drop for Held {
    fn drop(&mut self) {
        self.0.released.fetch_add(1, Ordering::SeqCst);
    }
}

impl AwakeHolds {
    pub(crate) fn hold(&self) -> DisplayAwakeHold {
        self.0.taken.fetch_add(1, Ordering::SeqCst);
        Box::new(Held(Arc::clone(&self.0)))
    }

    pub(crate) fn taken(&self) -> usize {
        self.0.taken.load(Ordering::SeqCst)
    }

    pub(crate) fn released(&self) -> usize {
        self.0.released.load(Ordering::SeqCst)
    }

    pub(crate) fn held(&self) -> bool {
        self.taken() > self.released()
    }
}

#[derive(Clone, Default)]
pub(crate) struct FakeScreen(Arc<Mutex<(ScreenState, Vec<Option<DisplaySelector>>)>>);

impl FakeScreen {
    pub(crate) fn set(&self, state: ScreenState) {
        self.0.lock().0 = state;
    }

    pub(crate) fn asked(&self) -> Vec<Option<DisplaySelector>> {
        self.0.lock().1.clone()
    }
}

impl ScreenProbe for FakeScreen {
    fn screen_state(&self, display: Option<&DisplaySelector>) -> ScreenState {
        let mut screen = self.0.lock();
        screen.1.push(display.cloned());
        screen.0
    }
}
