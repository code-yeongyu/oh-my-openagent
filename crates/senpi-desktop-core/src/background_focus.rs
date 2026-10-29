//! Focus ownership during background input, ported from oh-my-pi 0838d2ab44
//! (MIT, desktop/macos/skylight.rs). Native sampling stays in the backend.
//!
//! Invariants:
//! 1. Once disarmed, a lease never restores again.
//! 2. A target visit latches even if the user later leaves the target.
//! 3. Without a user choice, the target is restored however late it activates.
//! 4. A third app is restored only if it first appeared within 500 ms of an act.
//! 5. Ordinary typing never chooses an app; clicks, chords and panels can.
//! 6. A placed own-app click may change the retained key window, once only.
//! 7. Every press consults the visit latch; releases and cleanup do not.

use std::time::{Duration, Instant};

pub const USER_SWITCH_WINDOW: Duration = Duration::from_millis(250);
pub const SWITCH_SAMPLE: Duration = Duration::from_millis(5);
pub const ACTION_REFLEX: Duration = Duration::from_millis(500);

mod signals;

pub use signals::SwitchSignals;
use signals::UserSwitchWatch;

#[derive(Debug, PartialEq, Eq)]
pub enum FocusDecision {
    Observe,
    Restore,
    Disarm,
}

/// Once the user changes the front app/window, later target activations cannot
/// resurrect this action's old focus claim.
pub struct BackgroundFocusLease {
    pub previous: u32,
    pub target: u32,
    /// The user's key window; `None` when the front app showed no window. A
    /// click of theirs in their app that picks another of its windows makes
    /// that one the key window kept here.
    pub key: Option<u32>,
    user: UserSwitchWatch,
    /// When the action started, its first act on the target.
    started: Instant,
    /// The app in front, when it came forward, and whether that came within
    /// [`ACTION_REFLEX`] of one of the action's acts on its target.
    front_since: Option<(u32, Instant, bool)>,
    pub disarmed: bool,
    /// The user came to the target ([`TargetVisit`]).
    pub visited: bool,
}

impl BackgroundFocusLease {
    pub fn new(
        previous: u32,
        target: u32,
        key: Option<u32>,
        signals: SwitchSignals,
        now: Instant,
    ) -> Self {
        let user = UserSwitchWatch::new(previous, target, signals, now, USER_SWITCH_WINDOW);
        Self {
            previous,
            target,
            key,
            user,
            started: now,
            front_since: None,
            disarmed: false,
            visited: false,
        }
    }

    /// When `front` came forward, first seen at `now`, and whether it came
    /// within [`ACTION_REFLEX`] of the action's latest act on its target: what
    /// makes an app other than the target the action's doing.
    fn came_forward(
        &mut self,
        front: u32,
        signals: SwitchSignals,
        now: Instant,
    ) -> (Instant, bool) {
        match self.front_since {
            Some((psn, came, caused)) if psn == front => (came, caused),
            _ => {
                let sent = signals
                    .last_send
                    .map_or(self.started, |at| at.max(self.started));
                let caused = now.saturating_duration_since(sent) <= ACTION_REFLEX;
                self.front_since = Some((front, now, caused));
                (now, caused)
            }
        }
    }

    pub fn observe(
        &mut self,
        front: u32,
        key: Option<u32>,
        signals: SwitchSignals,
        now: Instant,
    ) -> FocusDecision {
        self.observe_read(front, key, now, signals, now)
    }

    /// [`Self::observe`] with the user's `key` window read from `asked` on: a
    /// click of theirs that may have picked it is aged from then, since that
    /// read can block, while `signals` and `now` come after it.
    pub fn observe_read(
        &mut self,
        front: u32,
        key: Option<u32>,
        asked: Instant,
        signals: SwitchSignals,
        now: Instant,
    ) -> FocusDecision {
        self.user.observe(signals, front, now);
        let (came, caused) = self.came_forward(front, signals, now);
        // The target coming forward with no switch of the user's just before is
        // the target activating itself, however long after the action's last
        // act, even while the user kept typing. Another app is the action's
        // doing only when it came right after one of the action's acts on its
        // target, as `TextEdit` does after Finder's ⌘O; any other app coming
        // forward is the user's (a slow launch, a Space swipe, an ⌥ or F-key
        // switcher) or unrelated, and the guard stands down. The switch sampler
        // sees every app as it comes forward, however long the observer's AX
        // probes block it.
        let action_brought =
            (front == self.target || caused) && self.user.picked(came, front).is_none();
        // A click in the user's own app that picked another of its windows
        // keeps them in their app: that window is the one the lease keeps.
        if !self.disarmed
            && front == self.previous
            && key.is_some_and(|key| Some(key) != self.key)
            && self.user.take_own_click(asked)
        {
            self.key = key;
        }
        if self.disarmed
            || (front == self.previous && key.is_some_and(|key| Some(key) != self.key))
            || (front != self.previous && !action_brought)
        {
            // The target in front now is the user's: they acted there, or the
            // lease no longer sends it back.
            self.visited |= front == self.target;
            self.disarmed = true;
            return FocusDecision::Disarm;
        }
        if front == self.previous {
            FocusDecision::Observe
        } else {
            FocusDecision::Restore
        }
    }

    /// Whether an app the action brought forward is in front at the end of the
    /// action without the user having switched to it: it came back after a
    /// hand-back, or macOS refused every hand-back while the user typed.
    pub fn left_in_front(&mut self, front: u32, signals: SwitchSignals, now: Instant) -> bool {
        front != self.previous && self.observe(front, None, signals, now) == FocusDecision::Restore
    }
}

impl BackgroundFocusLease {
    pub fn own_click_since(&self, now: Instant) -> bool {
        self.user.own_click_since(now)
    }
    pub fn keep_key(&mut self, key: u32, consume_click: bool) {
        self.key = Some(key);
        if consume_click {
            self.user.own_click = None;
        }
    }
}

#[cfg(test)]
mod tests;
