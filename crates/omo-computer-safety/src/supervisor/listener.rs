//! The stop listener's slot: armed and heard, deaf, re-arming on the bounded ladder, or parked.

use omo_computer_core::backend::{BackendResult, StopListener};
use omo_computer_core::capabilities::DeafReason;
use omo_computer_core::error::{EngineCode, Reason};

use crate::rearm::{ReArm, ReArmStep};
use crate::stop_path::GlobalListener;
use crate::timing::HEARTBEAT_FRESH_MS;

pub(super) enum Slot {
    /// `stopPath.start` has not run.
    Unarmed,
    /// The backend has no listener for this seat.
    Absent,
    Armed {
        listener: Box<dyn StopListener>,
        beat_ms: u64,
        deaf_reason: Option<DeafReason>,
    },
    Deaf {
        listener: Box<dyn StopListener>,
        reason: Option<DeafReason>,
    },
    ReArming(ReArm, Option<DeafReason>),
    Parked,
}

fn is_deaf(refusal: &omo_computer_core::backend::Refusal) -> bool {
    refusal.code == EngineCode::StopPathUnavailable && refusal.reason == Some(Reason::Deaf.wire())
}

impl Slot {
    pub(super) fn arm(
        listener: BackendResult<Box<dyn StopListener>>,
        deaf_reason: Option<DeafReason>,
        now_ms: u64,
    ) -> Self {
        match listener {
            Ok(listener) => Self::Armed {
                listener,
                beat_ms: now_ms,
                deaf_reason,
            },
            Err(_) => Self::Absent,
        }
    }

    /// Polls once; `true` when the user pressed the physical stop chord.
    pub(super) fn poll(
        &mut self,
        now_ms: u64,
        rearm: &mut dyn FnMut() -> BackendResult<Box<dyn StopListener>>,
    ) -> bool {
        let current = std::mem::replace(self, Self::Unarmed);
        let (next, pressed) = match current {
            Self::Armed {
                mut listener,
                beat_ms: _,
                deaf_reason,
            } => match listener.poll_stop() {
                Ok(pressed) => (
                    Self::Armed {
                        listener,
                        beat_ms: now_ms,
                        deaf_reason,
                    },
                    pressed,
                ),
                Err(refusal) if is_deaf(&refusal) => (
                    Self::Deaf {
                        listener,
                        reason: deaf_reason,
                    },
                    false,
                ),
                Err(_) => (Self::ReArming(ReArm::begin(now_ms), deaf_reason), false),
            },
            Self::Deaf {
                mut listener,
                reason,
            } => match listener.poll_stop() {
                Ok(pressed) => (
                    Self::Armed {
                        listener,
                        beat_ms: now_ms,
                        deaf_reason: reason,
                    },
                    pressed,
                ),
                Err(_) => (Self::Deaf { listener, reason }, false),
            },
            Self::ReArming(mut ladder, deaf_reason) => {
                let next = match ladder.step(now_ms) {
                    ReArmStep::Wait => Self::ReArming(ladder, deaf_reason),
                    ReArmStep::Parked => Self::Parked,
                    ReArmStep::Attempt => match rearm() {
                        Ok(listener) => Self::Armed {
                            listener,
                            beat_ms: now_ms,
                            deaf_reason,
                        },
                        Err(_) => {
                            ladder.failed(now_ms);
                            match ladder.step(now_ms) {
                                ReArmStep::Parked => Self::Parked,
                                _ => Self::ReArming(ladder, deaf_reason),
                            }
                        }
                    },
                };
                (next, false)
            }
            other => (other, false),
        };
        *self = next;
        pressed
    }

    pub(super) fn global(&self, now_ms: u64) -> GlobalListener {
        // RED: liveness, deafness and parking are not read yet.
        let _ = (now_ms, HEARTBEAT_FRESH_MS, DeafReason::ListenerParked);
        match self {
            Self::Unarmed | Self::Absent => GlobalListener::None,
            _ => GlobalListener::Fresh,
        }
    }
}
