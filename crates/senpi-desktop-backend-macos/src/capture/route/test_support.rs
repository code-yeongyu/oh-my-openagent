//! Route tests own their reason store rather than sharing process-global state.

use std::cell::Cell;
use std::sync::atomic::{AtomicU8, Ordering};

use super::SckUnavailable;

thread_local! {
    pub(crate) static AVAILABILITY: Cell<Option<Result<(), SckUnavailable>>> =
        const { Cell::new(None) };
    pub(super) static LEGACY_REASONS: AtomicU8 = const { AtomicU8::new(0) };
}

pub(crate) fn override_availability(value: Option<Result<(), SckUnavailable>>) {
    AVAILABILITY.with(|cell| cell.set(value));
}

pub(super) struct ReasonsGuard;

impl ReasonsGuard {
    pub(super) fn new() -> Self {
        LEGACY_REASONS.with(|store| store.store(0, Ordering::Relaxed));
        Self
    }
}

impl Drop for ReasonsGuard {
    fn drop(&mut self) {
        LEGACY_REASONS.with(|store| store.store(0, Ordering::Relaxed));
    }
}
