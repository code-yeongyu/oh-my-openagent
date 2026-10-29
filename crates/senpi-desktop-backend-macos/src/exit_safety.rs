//! Exit hooks invalidate event taps without borrowing a busy backend or joining
//! the panicking thread. Registrations own retained CF handles, not contexts.

use std::sync::{Arc, Weak};
use std::sync::atomic::{AtomicU64, Ordering};

use parking_lot::Mutex;

type Cleanup = dyn Fn() + Send + Sync;
pub(crate) type Registration = Arc<Cleanup>;
static TAPS: Mutex<Vec<Weak<Cleanup>>> = Mutex::new(Vec::new());
static OWNERS: Mutex<Vec<Weak<Cleanup>>> = Mutex::new(Vec::new());
static EPOCH: AtomicU64 = AtomicU64::new(0);

pub(crate) fn epoch() -> u64 {
    EPOCH.load(Ordering::Acquire)
}

pub(crate) fn register(cleanup: impl Fn() + Send + Sync + 'static) -> Registration {
    register_in(&TAPS, cleanup)
}

pub(crate) fn register_owner(cleanup: impl Fn() + Send + Sync + 'static) -> Registration {
    register_in(&OWNERS, cleanup)
}

fn register_in(
    registry: &Mutex<Vec<Weak<Cleanup>>>,
    cleanup: impl Fn() + Send + Sync + 'static,
) -> Registration {
    let cleanup: Registration = Arc::new(cleanup);
    let mut taps = registry.lock();
    taps.retain(|tap| tap.strong_count() != 0);
    taps.push(Arc::downgrade(&cleanup));
    cleanup
}

/// Invalidates live input-observation/reroute taps on normal exit, signals and
/// the panic hook. Callbacks must be idempotent and must not join any thread.
pub fn invalidate_input_observers() {
    EPOCH.fetch_add(1, Ordering::AcqRel);
    let taps: Vec<_> = TAPS.lock().iter().filter_map(Weak::upgrade).collect();
    for tap in taps {
        tap();
    }
}

/// Normal and signal exits also join reroute owners, so their final count and
/// disarm record are flushed before the executable returns.
pub fn shutdown_input_observers() {
    invalidate_input_observers();
    let owners: Vec<_> = OWNERS.lock().iter().filter_map(Weak::upgrade).collect();
    for owner in owners {
        owner();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn exit_invalidates_live_registrations_and_retired_contexts_are_unreachable() {
        let live = Arc::new(AtomicBool::new(false));
        let marked = Arc::clone(&live);
        let registration = register(move || marked.store(true, Ordering::SeqCst));
        shutdown_input_observers();
        assert!(live.load(Ordering::SeqCst));
        drop(registration);
        live.store(false, Ordering::SeqCst);
        shutdown_input_observers();
        assert!(!live.load(Ordering::SeqCst));
    }
}
