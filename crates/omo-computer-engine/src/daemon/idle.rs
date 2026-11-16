//! Idle exit: the daemon ends after 300 s with NO open session (d-remote.md W4 "idle exit only
//! with no open session"). The clock is real time, or under `OMO_COMPUTER_FAKE_CLOCK` the time
//! `$/test.advanceClock` advanced, so the 300 s are testable without waiting them.

use std::collections::HashSet;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

pub const IDLE_EXIT: Duration = Duration::from_secs(300);

struct State {
    open: HashSet<usize>,
    fake_ms: u64,
    since_real: Instant,
    since_fake_ms: u64,
}

pub struct Idle {
    fake: bool,
    state: Mutex<State>,
}

impl Idle {
    #[must_use]
    pub fn new(fake: bool) -> Self {
        Self {
            fake,
            state: Mutex::new(State { open: HashSet::new(), fake_ms: 0, since_real: Instant::now(), since_fake_ms: 0 }),
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn opened(&self, connection: usize) {
        self.state().open.insert(connection);
    }

    /// A session closed (or its connection ended); the idle clock restarts once none is open.
    pub fn closed(&self, connection: usize) {
        let mut state = self.state();
        if state.open.remove(&connection) && state.open.is_empty() {
            state.since_real = Instant::now();
            state.since_fake_ms = state.fake_ms;
        }
    }

    pub fn advance(&self, ms: u64) {
        if self.fake {
            let mut state = self.state();
            state.fake_ms = state.fake_ms.saturating_add(ms);
        }
    }

    #[must_use]
    pub fn expired(&self) -> bool {
        let state = self.state();
        if !state.open.is_empty() {
            return false;
        }
        if self.fake {
            Duration::from_millis(state.fake_ms.saturating_sub(state.since_fake_ms)) >= IDLE_EXIT
        } else {
            state.since_real.elapsed() >= IDLE_EXIT
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_open_session_holds_the_daemon_and_its_close_restarts_the_clock() {
        let idle = Idle::new(true);
        idle.opened(1);
        idle.advance(301_000);
        assert!(!idle.expired());
        idle.closed(1);
        assert!(!idle.expired(), "the clock restarts at the close");
        idle.advance(300_000);
        assert!(idle.expired());
    }
}
