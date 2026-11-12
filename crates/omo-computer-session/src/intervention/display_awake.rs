//! `DisplayAwakeHold` (design row C22, contract acceptance 66): the session-scoped hold that
//! keeps the display awake while the session acts. An exec acquires it; it lapses back to
//! `idle` after `display_awake_grace_ms` without an exec; it is `capped` once held for
//! `display_awake_session_cap_ms`; `display.release` parks it `released`, and nothing
//! re-acquires it until `display.resume`.

/// The two settings that bound the hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HoldLimits {
    pub grace_ms: u64,
    pub session_cap_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayAwakeHold {
    Idle,
    Held { since_ms: u64, last_exec_ms: u64 },
    Released,
    Capped,
}

impl DisplayAwakeHold {
    /// An exec at `now_ms`.
    #[must_use]
    pub const fn on_exec(self, now_ms: u64, limits: HoldLimits) -> Self {
        match self {
            Self::Idle => Self::Held {
                since_ms: now_ms,
                last_exec_ms: now_ms,
            },
            Self::Held { since_ms, .. } => {
                if now_ms.saturating_sub(since_ms) >= limits.session_cap_ms {
                    Self::Capped
                } else {
                    Self::Held {
                        since_ms,
                        last_exec_ms: now_ms,
                    }
                }
            }
            Self::Released | Self::Capped => self,
        }
    }

    /// The clock at `now_ms`: a held hold lapses after the grace, or caps.
    #[must_use]
    pub const fn tick(self, now_ms: u64, limits: HoldLimits) -> Self {
        match self {
            Self::Held {
                since_ms,
                last_exec_ms,
            } => {
                if now_ms.saturating_sub(since_ms) >= limits.session_cap_ms {
                    Self::Capped
                } else if now_ms.saturating_sub(last_exec_ms) >= limits.grace_ms {
                    Self::Idle
                } else {
                    self
                }
            }
            Self::Idle | Self::Released | Self::Capped => self,
        }
    }

    /// `display.release`.
    #[must_use]
    pub const fn release(self) -> Self {
        Self::Released
    }

    /// `display.resume`: only a released hold changes, back to `idle`.
    #[must_use]
    pub const fn resume(self) -> Self {
        match self {
            Self::Released => Self::Idle,
            Self::Idle | Self::Held { .. } | Self::Capped => self,
        }
    }

    #[must_use]
    pub const fn holds_display_awake(self) -> bool {
        matches!(self, Self::Held { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIMITS: HoldLimits = HoldLimits {
        grace_ms: 1_000,
        session_cap_ms: 10_000,
    };

    #[test]
    fn an_exec_holds_and_the_grace_lapses_it_to_idle() {
        let held = DisplayAwakeHold::Idle.on_exec(100, LIMITS);
        assert!(held.holds_display_awake());
        assert_eq!(held.tick(1_099, LIMITS), held);
        assert_eq!(held.tick(1_100, LIMITS), DisplayAwakeHold::Idle);
    }

    #[test]
    fn the_session_cap_caps_and_nothing_reacquires_after() {
        let mut hold = DisplayAwakeHold::Idle.on_exec(0, LIMITS);
        for now in (500..10_000).step_by(500) {
            hold = hold.on_exec(now, LIMITS);
        }
        assert!(hold.holds_display_awake());
        let capped = hold.on_exec(10_000, LIMITS);
        assert_eq!(capped, DisplayAwakeHold::Capped);
        assert_eq!(capped.on_exec(20_000, LIMITS), DisplayAwakeHold::Capped);
        assert_eq!(hold.tick(10_000, LIMITS), DisplayAwakeHold::Capped);
    }

    #[test]
    fn release_is_session_scoped_until_resume() {
        let released = DisplayAwakeHold::Idle.on_exec(0, LIMITS).release();
        assert_eq!(released.on_exec(5, LIMITS), DisplayAwakeHold::Released);
        assert_eq!(released.tick(50_000, LIMITS), DisplayAwakeHold::Released);
        let resumed = released.resume();
        assert_eq!(resumed, DisplayAwakeHold::Idle);
        assert!(resumed.on_exec(6, LIMITS).holds_display_awake());
        assert_eq!(DisplayAwakeHold::Capped.resume(), DisplayAwakeHold::Capped);
    }
}
