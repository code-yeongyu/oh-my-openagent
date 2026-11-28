//! One observer registration, shared by the caller that asks for it and the AX thread that
//! makes it. Whichever side settles it first decides for both: the caller gives up at its
//! deadline (the registration is then abandoned and the thread keeps nothing it made for it),
//! or the thread answers first (the caller returns that answer). The caller's answer and the
//! thread's kept set therefore never disagree, and a pid already kept answers `true` without a
//! second observer.

use std::collections::BTreeMap;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    Pending,
    /// The caller stopped waiting before the thread answered.
    Abandoned,
    Answered(bool),
}

/// One registration request; clones share its state.
#[derive(Debug, Clone)]
pub struct Registration {
    shared: Arc<(Mutex<State>, Condvar)>,
    until: Instant,
}

impl Registration {
    /// A request the caller waits on until `until`.
    #[must_use]
    pub fn new(until: Instant) -> Self {
        Self {
            shared: Arc::new((Mutex::new(State::Pending), Condvar::new())),
            until,
        }
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.shared.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The caller's answer: the thread's when it answers by `until`; otherwise the request is
    /// abandoned and the answer is `false`.
    #[must_use]
    pub fn wait(&self) -> bool {
        let mut state = self.state();
        loop {
            match *state {
                State::Answered(kept) => return kept,
                State::Abandoned => return false,
                State::Pending => {
                    let Some(left) = remaining(self.until) else {
                        *state = State::Abandoned;
                        return false;
                    };
                    state = self
                        .shared
                        .1
                        .wait_timeout(state, left)
                        .unwrap_or_else(PoisonError::into_inner)
                        .0;
                }
            }
        }
    }

    /// The time the thread may still spend making this registration; `None` once the caller
    /// stopped waiting or its deadline passed.
    #[must_use]
    pub fn left(&self) -> Option<Duration> {
        if *self.state() == State::Pending {
            remaining(self.until)
        } else {
            None
        }
    }

    /// The caller giving up before the thread answered (what [`Self::wait`] does at `until`).
    #[cfg(test)]
    pub fn abandon(&self) {
        let mut state = self.state();
        if *state == State::Pending {
            *state = State::Abandoned;
        }
    }

    /// The thread's answer; `true` only when the caller still waits for it and `kept` is true.
    fn answer(&self, kept: bool) -> bool {
        let mut state = self.state();
        if *state != State::Pending {
            return false;
        }
        *state = State::Answered(kept);
        self.shared.1.notify_all();
        kept
    }
}

fn remaining(until: Instant) -> Option<Duration> {
    until
        .checked_duration_since(Instant::now())
        .filter(|left| !left.is_zero())
}

/// The observers the AX thread keeps, one per pid.
#[derive(Debug)]
pub struct Kept<T> {
    by_pid: BTreeMap<u32, T>,
}

impl<T> Default for Kept<T> {
    fn default() -> Self {
        Self {
            by_pid: BTreeMap::new(),
        }
    }
}

impl<T> Kept<T> {
    /// Settles `registration` for `pid` and returns the observer it newly kept. A pid already
    /// kept answers `true` and makes nothing; an abandoned or overdue request makes nothing;
    /// otherwise `make` builds the observer (bounded by `registration.left()`), and it is kept
    /// only when the caller still waits for the answer, else it is dropped here.
    pub fn register(
        &mut self,
        pid: u32,
        registration: &Registration,
        make: impl FnOnce(&Registration) -> Option<T>,
    ) -> Option<&T> {
        if self.by_pid.contains_key(&pid) {
            registration.answer(true);
            return None;
        }
        let made = registration.left().and_then(|_| make(registration));
        let Some(made) = made else {
            registration.answer(false);
            return None;
        };
        if !registration.answer(true) {
            return None;
        }
        Some(self.by_pid.entry(pid).or_insert(made))
    }

    #[must_use]
    pub fn contains(&self, pid: u32) -> bool {
        self.by_pid.contains_key(&pid)
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.by_pid.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.by_pid.is_empty()
    }
}
