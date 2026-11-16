//! The admission pause: while the screen is locked, a local system is suspended, or the user
//! works in the frontmost target, an exec waits on the backend's clock instead of sending,
//! bounded by `computer.pause_ceiling_ms`. Each wait is recorded as `ActionReport.paused[]`.
//! The stop listener is polled on every tick, so a pause never holds the stop path: a latched
//! stop ends the wait and the gate answers `Suspended`. A backend without a clock cannot wait:
//! the lock falls through to the gate's own `ScreenLocked`, a suspend answers
//! `SessionInactive{system_suspended}`, and user input answers the one-send refusal
//! `BackgroundUnavailable{user_active_in_target}`.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::intervention::{Pause, PauseReason, PAUSE_TICK_MS};
use omo_computer_safety::NoHolds;

use crate::intervention::user_active_in_target;
use crate::session_state::{ceiling_refusal, hold, sample};
use crate::Session;

/// The pauses of one admission, consecutive waits for one reason merged.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Pauses(Vec<Pause>);

impl Pauses {
    pub fn add(&mut self, reason: PauseReason, ms: u64) {
        match self.0.last_mut() {
            Some(last) if last.reason == reason => last.ms = last.ms.saturating_add(ms),
            _ => self.0.push(Pause { reason, ms }),
        }
    }

    #[must_use]
    pub fn into_vec(self) -> Vec<Pause> {
        self.0
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// Why an admission pause ended without admitting the call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PauseEnded {
    pub refusal: Refusal,
    pub paused: Vec<Pause>,
}

const USER_ACTIVE_IN_TARGET: Refusal = Refusal::new(
    EngineCode::BackgroundUnavailable,
    Reason::UserActiveInTarget.wire(),
);

impl Session {
    /// Waits while a hold applies to a call aimed at `pid`.
    ///
    /// # Errors
    /// The hold outlasted `ceiling_ms` (typed by its reason), or the backend cannot wait.
    pub(crate) fn pause_admission(
        &mut self,
        pid: Option<u32>,
        ceiling_ms: u64,
    ) -> Result<Vec<Pause>, PauseEnded> {
        let mut pauses = Pauses::default();
        let mut waited: u64 = 0;
        loop {
            let reason = hold(&sample(self.backend.as_ref())).or_else(|| {
                pid.filter(|pid| user_active_in_target(self.backend.as_ref(), *pid))
                    .map(|_| PauseReason::UserActive)
            });
            let Some(reason) = reason else {
                return Ok(pauses.into_vec());
            };
            if self.guard.supervisor().latch().is_some() {
                return Ok(pauses.into_vec());
            }
            if waited > ceiling_ms {
                return Err(PauseEnded {
                    refusal: ceiling_refusal(reason),
                    paused: pauses.into_vec(),
                });
            }
            let step = PAUSE_TICK_MS.min(ceiling_ms.saturating_add(1).saturating_sub(waited));
            let Some(clock) = self.backend.clock() else {
                return cannot_wait(reason, pauses);
            };
            clock.wait_ms(step);
            waited = waited.saturating_add(step);
            pauses.add(reason, step);
            let backend = &mut self.backend;
            self.guard.observe(&mut || backend.stop_listener(), &mut NoHolds);
        }
    }
}

fn cannot_wait(reason: PauseReason, pauses: Pauses) -> Result<Vec<Pause>, PauseEnded> {
    let refusal = match reason {
        PauseReason::ScreenLocked => return Ok(pauses.into_vec()),
        PauseReason::UserActive => USER_ACTIVE_IN_TARGET,
        PauseReason::SystemSuspended => ceiling_refusal(reason),
    };
    Err(PauseEnded {
        refusal,
        paused: pauses.into_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consecutive_waits_for_one_reason_merge() {
        let mut pauses = Pauses::default();
        assert!(pauses.is_empty());
        pauses.add(PauseReason::UserActive, 100);
        pauses.add(PauseReason::UserActive, 100);
        pauses.add(PauseReason::ScreenLocked, 50);
        assert_eq!(
            pauses.into_vec(),
            vec![
                Pause {
                    reason: PauseReason::UserActive,
                    ms: 200
                },
                Pause {
                    reason: PauseReason::ScreenLocked,
                    ms: 50
                },
            ]
        );
    }
}
