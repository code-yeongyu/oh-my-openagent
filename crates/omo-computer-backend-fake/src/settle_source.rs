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

/// The scripted indicator token as the busy predicate names it.
fn indicator(token: Option<&str>) -> BusyIndicator {
    let token = token.unwrap_or_default().to_ascii_lowercase();
    if token.contains("spinner") {
        BusyIndicator::Spinner
    } else if token.contains("frame") {
        BusyIndicator::FrameChanging
    } else if token.contains("progress")
        || token.contains("busyindicator")
        || token.contains("ring")
    {
        BusyIndicator::Progress
    } else {
        BusyIndicator::AxBusy
    }
}

/// FNV-1a over the body: the fingerprint keeps a hash, never the text.
fn body_hash(body: &str) -> String {
    let hash = body.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    });
    format!("{hash:016x}")
}

/// The first post arriving after `now` and no later than `until`, as an absolute time.
fn next_post(posts: &[NotificationPost], start: u64, now: u64, until: u64) -> Option<u64> {
    posts
        .iter()
        .map(|post| start.saturating_add(post.t_ms))
        .filter(|at| *at > now && *at <= until)
        .min()
}

/// Fires every scripted stop-chord press due by `now`: the live listener's next poll reports it.
fn fire_stop_presses(state: &mut FakeState, now: u64) {
    let start = state.start_ms;
    let due = state
        .scenario
        .stop_timeline
        .iter()
        .skip(state.stop_press_pos)
        .take_while(|press| start.saturating_add(press.t_ms) <= now)
        .count();
    if due > 0 {
        state.stop_press_pos += due;
        state.stop_pressed = true;
    }
}

/// The observer event a notification post raises on the notification surface's tree.
pub const NOTIFICATION_EVENT: &str = "notification_posted";
/// The window id the notification surface's events carry.
pub const NOTIFICATION_SURFACE: &str = "notification-surface";

impl SettleSource for FakeSettleSource {
    fn wait_event(&mut self, until_ms: u64) -> BackendResult<Option<AxEvent>> {
        let mut state = self.lock();
        let now = self.clock.now_ms();
        let start = state.start_ms;
        let from = state.ax_event_pos;
        let next_ax = state
            .scenario
            .ax_notification_timeline
            .get(from)
            .map(|event| (start.saturating_add(event.t_ms).max(now), event.clone()));
        let post_at = state
            .scenario
            .notification_timeline
            .as_deref()
            .and_then(|posts| next_post(posts, start, now, until_ms));
        let wake = [next_ax.as_ref().map(|(at, _)| *at), post_at]
            .into_iter()
            .flatten()
            .filter(|at| *at <= until_ms)
            .min();
        let Some(wake) = wake else {
            self.clock.advance(until_ms.saturating_sub(now));
            fire_stop_presses(&mut state, until_ms.max(now));
            return Ok(None);
        };
        self.clock.advance(wake - now);
        fire_stop_presses(&mut state, wake);
        if let Some((_, event)) = next_ax.filter(|(at, _)| *at == wake) {
            state.ax_event_pos = from + 1;
            if event.closes {
                state.exited.insert(event.window.clone());
            }
            return Ok(Some(AxEvent {
                kind: event.kind,
                window: event.window,
            }));
        }
        Ok(Some(AxEvent {
            kind: NOTIFICATION_EVENT.to_owned(),
            window: NOTIFICATION_SURFACE.to_owned(),
        }))
    }

    fn busy(&mut self, window: &str) -> BackendResult<Option<BusyIndicator>> {
        let state = self.lock();
        let elapsed = state.elapsed(&self.clock);
        Ok(
            match timeline::loading_state(&state.scenario.busy_timeline, window, elapsed) {
                LoadingState::Busy { indicator: token } => Some(indicator(token.as_deref())),
                LoadingState::Unknown | LoadingState::Idle => None,
            },
        )
    }

    fn notifications(&mut self) -> BackendResult<Vec<NotificationFingerprint>> {
        let state = self.lock();
        let posts = state
            .scenario
            .notification_timeline
            .as_deref()
            .ok_or(NO_NOTIFICATION_SURFACE)?;
        let (start, now) = (state.start_ms, self.clock.now_ms());
        Ok(posts
            .iter()
            .map(|post| (start.saturating_add(post.t_ms), post))
            .filter(|(at, _)| *at <= now)
            .map(|(at, post)| NotificationFingerprint {
                app: post.app.clone(),
                title: post.title.clone(),
                body_hash: body_hash(&post.body),
                arrived_at_ms: at,
            })
            .collect())
    }
}
