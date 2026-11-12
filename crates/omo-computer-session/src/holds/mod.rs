//! Row 23's held-input ledger in the session (design row C9, `design/d-safety.md` '### 6.'):
//! ONE owner, kept in the session's control state beside the lease (the hold verbs press and
//! lift through it) and shared with the lease hook (every lease end releases through it), so no two copies drift.

mod deadline;
mod dispatch;
mod hook;
mod refuse;
mod verbs;

#[cfg(test)]
mod tests;

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use omo_computer_core::backend::{Backend, Delivered, InputEvent, Route};
use omo_computer_core::holds::{Held, HoldLedger, MAX_HOLD_MS};

pub(crate) use hook::with_holds;
pub(crate) use refuse::{hold_duration, scroll_steps};

#[derive(Debug, Default)]
struct Ledger {
    holds: HoldLedger,
    /// The tag of the session that pressed, so a release carries the engine's tag.
    tag: u64,
    /// When each hold reaches the bound, oldest first.
    deadlines: Vec<u64>,
}

/// The session's held inputs, shared by the session and its lease hook.
#[derive(Debug, Clone, Default)]
pub struct SharedLedger(Arc<Mutex<Ledger>>);

impl SharedLedger {
    fn lock(&self) -> MutexGuard<'_, Ledger> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn press(&self, held: Held, now_ms: u64, tag: u64) {
        let mut ledger = self.lock();
        ledger.holds.press(held, now_ms);
        ledger.tag = tag;
        ledger.deadlines.push(now_ms.saturating_add(MAX_HOLD_MS));
    }

    /// Forgets a hold the caller released; `false` when the ledger no longer held it.
    pub(crate) fn lift(&self, held: &Held) -> bool {
        self.lock().holds.lift(held)
    }

    #[must_use]
    pub fn held(&self) -> Vec<Held> {
        self.lock().holds.held()
    }

    /// The clock time the oldest hold reaches the bound, `None` with nothing held (R49).
    #[must_use]
    pub fn next_deadline(&self) -> Option<u64> {
        let ledger = self.lock();
        (!ledger.holds.is_empty()).then(|| ledger.deadlines.iter().copied().min()).flatten()
    }

    /// Releases every hold through the single post site, last press first; a key the user
    /// holds physically is left down.
    pub(crate) fn release_all(&self, backend: &mut dyn Backend) -> Delivered {
        let (events, tag) = {
            let mut ledger = self.lock();
            ledger.deadlines.clear();
            (ledger.holds.release_all(&backend.user_held_keys()), ledger.tag)
        };
        post(backend, events, tag)
    }

    /// Releases the holds that reached the bound at `now_ms` (R49): the ledger keeps the
    /// rest, and a later `up` of a released hold answers `partial` with nothing sent.
    pub(crate) fn release_expired(&self, backend: &mut dyn Backend, now_ms: u64) -> Delivered {
        let (events, tag) = {
            let mut ledger = self.lock();
            let expired = ledger.holds.expired(now_ms);
            if expired.is_empty() {
                return Delivered { count: 0, of: 0 };
            }
            let mut released = HoldLedger::default();
            for held in expired {
                ledger.holds.lift(&held);
                released.press(held, now_ms);
            }
            ledger.deadlines.retain(|deadline| *deadline > now_ms);
            (released.release_all(&backend.user_held_keys()), ledger.tag)
        };
        post(backend, events, tag)
    }
}

fn post(backend: &mut dyn Backend, events: Vec<InputEvent>, tag: u64) -> Delivered {
    let of = u32::try_from(events.len()).unwrap_or(u32::MAX);
    let count = events
        .into_iter()
        .filter(|event| crate::intervention::post_one(backend, event.clone(), tag, Route::ForegroundHid).is_ok())
        .count();
    Delivered { count: u32::try_from(count).unwrap_or(u32::MAX), of }
}
