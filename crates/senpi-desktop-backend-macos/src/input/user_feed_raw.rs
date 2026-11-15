//! The user's presses before any per-app filter, for the takeover check key
//! priming repeats just before its first key (DESIGN 7 step 0'). The
//! session's intervention record only covers apps it registered, so priming
//! reads the watch's raw feed instead. Reading it must not take presses away
//! from the session: [`RawFeed`] stands between the watch and the session,
//! keeps what it drained for the session's next read, and remembers the
//! newest press.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use senpi_desktop_core::user_input::{UserInputFeed, UserPress, UserPresses};

/// The watch's feed with the newest press kept for priming.
pub(crate) struct RawFeed {
    inner: Arc<dyn UserInputFeed>,
    state: Mutex<Drained>,
}

#[derive(Default)]
struct Drained {
    /// Presses drained from the watch the session has not read yet.
    pending: VecDeque<UserPress>,
    dropped: u64,
    newest: Option<Instant>,
}

impl RawFeed {
    pub(crate) fn new(inner: Arc<dyn UserInputFeed>) -> Self {
        Self { inner, state: Mutex::default() }
    }

    /// Moves the watch's presses into the pending queue, noting the newest.
    fn drain(&self, state: &mut Drained) {
        let UserPresses { presses, dropped } = self.inner.take();
        if let Some(last) = presses.iter().map(|press| press.at).max() {
            state.newest = Some(state.newest.map_or(last, |newest| newest.max(last)));
        }
        state.pending.extend(presses);
        state.dropped += dropped;
    }

    /// Whether the user pressed a key or clicked anywhere within `window`
    /// before `now`.
    pub(crate) fn pressed_within(&self, window: Duration, now: Instant) -> bool {
        let mut state = self.state.lock();
        self.drain(&mut state);
        state.newest.is_some_and(|newest| now.saturating_duration_since(newest) < window)
    }
}

impl UserInputFeed for RawFeed {
    fn take(&self) -> UserPresses {
        let mut state = self.state.lock();
        self.drain(&mut state);
        UserPresses {
            presses: state.pending.drain(..).collect(),
            dropped: std::mem::take(&mut state.dropped),
        }
    }

    fn process_started(&self, pid: u32) -> Option<u64> {
        self.inner.process_started(pid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use senpi_desktop_core::user_input::UserPressKind;

    #[derive(Default)]
    struct Scripted(Mutex<Vec<UserPresses>>);

    impl UserInputFeed for Scripted {
        fn take(&self) -> UserPresses {
            self.0.lock().pop().unwrap_or_default()
        }
        fn process_started(&self, pid: u32) -> Option<u64> {
            Some(u64::from(pid))
        }
    }

    fn press(pid: u32, at: Instant) -> UserPress {
        UserPress { pid, kind: UserPressKind::Key, at }
    }

    #[test]
    fn priming_reads_keep_every_press_for_the_session() {
        let start = Instant::now();
        let first = UserPresses { presses: vec![press(7, start)], dropped: 2 };
        let second = UserPresses { presses: vec![press(9, start + Duration::from_millis(5))], dropped: 0 };
        let raw = RawFeed::new(Arc::new(Scripted(Mutex::new(vec![second, first]))));
        let now = start + Duration::from_millis(1_000);
        assert!(raw.pressed_within(Duration::from_millis(1_500), now));
        assert!(raw.pressed_within(Duration::from_millis(1_500), now), "the newest press is remembered");
        let taken = raw.take();
        assert_eq!(taken.presses.iter().map(|press| press.pid).collect::<Vec<_>>(), [7, 9]);
        assert_eq!(taken.dropped, 2);
        assert_eq!(raw.take(), UserPresses::default());
        assert!(!raw.pressed_within(Duration::from_millis(500), now));
        assert_eq!(raw.process_started(4), Some(4));
    }
}
