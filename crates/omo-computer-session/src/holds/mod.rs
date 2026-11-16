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

use omo_computer_core::backend::{Backend, Delivered, Route};
use omo_computer_core::holds::{Held, HoldLedger, Release};

pub(crate) use hook::with_holds;
pub(crate) use refuse::{hold_duration, scroll_steps};

#[derive(Debug, Default)]
struct Ledger {
    holds: HoldLedger,
    /// The tag of the session that pressed, so a release carries the engine's tag.
    tag: u64,
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
        self.lock().holds.next_deadline()
    }

    /// The mark of the next press; [`Self::release_from`] with it releases exactly what was
    /// pressed after it (review L7 of #13360).
    pub(crate) fn mark(&self) -> u64 {
        self.lock().holds.mark()
    }

    /// Releases every hold through the single post site, last press first; a key the user
    /// holds physically is left down.
    pub(crate) fn release_all(&self, backend: &mut dyn Backend) -> Delivered {
        let user_held = backend.user_held_keys();
        self.post(backend, |holds| holds.take_all(&user_held))
    }

    /// Releases only `which` (the holds one call pressed), last press first; every other
    /// hold stays held.
    pub(crate) fn release(&self, backend: &mut dyn Backend, which: &[Held]) -> Delivered {
        let user_held = backend.user_held_keys();
        self.post(backend, |holds| holds.take_held(which, &user_held))
    }

    /// Releases exactly the holds pressed at or after `mark`, never an earlier hold of the
    /// same key or button.
    pub(crate) fn release_from(&self, backend: &mut dyn Backend, mark: u64) -> Delivered {
        let user_held = backend.user_held_keys();
        self.post(backend, |holds| holds.take_from(mark, &user_held))
    }

    /// Releases the holds that reached the bound at `now_ms` (R49): the ledger keeps the
    /// rest, and a later `up` of a released hold answers `partial` with nothing sent.
    pub(crate) fn release_expired(&self, backend: &mut dyn Backend, now_ms: u64) -> Delivered {
        let user_held = backend.user_held_keys();
        self.post(backend, |holds| {
            let expired = holds.expired(now_ms);
            if expired.is_empty() { Vec::new() } else { holds.take_held(&expired, &user_held) }
        })
    }

    /// Takes the releases `which` plans and posts them through the single post site; a hold
    /// whose release any post of failed goes back into the ledger, so the next exit path
    /// releases it again (review L9 of #13360).
    fn post(&self, backend: &mut dyn Backend, which: impl FnOnce(&mut HoldLedger) -> Vec<Release>) -> Delivered {
        let (releases, tag) = {
            let mut ledger = self.lock();
            let releases = which(&mut ledger.holds);
            (releases, ledger.tag)
        };
        let (mut count, mut of) = (0_u32, 0_u32);
        for release in releases {
            of = of.saturating_add(u32::try_from(release.events.len()).unwrap_or(u32::MAX));
            let sent = release
                .events
                .iter()
                .filter(|event| crate::intervention::post_one(backend, (*event).clone(), tag, Route::ForegroundHid).is_ok())
                .count();
            count = count.saturating_add(u32::try_from(sent).unwrap_or(u32::MAX));
            if sent < release.events.len() {
                self.lock().holds.restore(release);
            }
        }
        Delivered { count, of }
    }
}
