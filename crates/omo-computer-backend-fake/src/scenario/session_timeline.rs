//! `session_timeline`: the session-state fields by fake-clock time (lock, display sleep, a
//! deactivated session, the screen saver, Secure Input, a system suspend). An empty timeline
//! keeps the persona's unprobed `"unknown"` state; a scripted one starts from an unlocked,
//! awake, active session and applies every mark due by the clock's elapsed time, in order.

use omo_computer_core::session_state::{SessionPauseReason, SessionState, Tristate, UserActive};
use serde::Deserialize;

/// One change of the scripted session state at `t_ms` after backend creation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionMark {
    pub t_ms: u64,
    #[serde(default)]
    pub screen_locked: Option<bool>,
    #[serde(default)]
    pub display_asleep: Option<bool>,
    #[serde(default)]
    pub session_active: Option<bool>,
    #[serde(default)]
    pub screensaver_active: Option<bool>,
    #[serde(default)]
    pub secure_input_active: Option<bool>,
    #[serde(default)]
    pub system_suspended: Option<bool>,
}

#[derive(Debug, Clone, Copy)]
struct Fields {
    screen_locked: bool,
    display_asleep: bool,
    session_active: bool,
    screensaver_active: bool,
    secure_input_active: bool,
    system_suspended: bool,
}

impl Fields {
    const START: Self = Self {
        screen_locked: false,
        display_asleep: false,
        session_active: true,
        screensaver_active: false,
        secure_input_active: false,
        system_suspended: false,
    };

    fn apply(&mut self, mark: &SessionMark) {
        let set = |field: &mut bool, value: Option<bool>| {
            if let Some(value) = value {
                *field = value;
            }
        };
        set(&mut self.screen_locked, mark.screen_locked);
        set(&mut self.display_asleep, mark.display_asleep);
        set(&mut self.session_active, mark.session_active);
        set(&mut self.screensaver_active, mark.screensaver_active);
        set(&mut self.secure_input_active, mark.secure_input_active);
        set(&mut self.system_suspended, mark.system_suspended);
    }

    fn pause_reasons(self) -> Vec<SessionPauseReason> {
        [
            (self.screen_locked, SessionPauseReason::ScreenLocked),
            (self.screensaver_active, SessionPauseReason::ScreensaverActive),
            (!self.session_active, SessionPauseReason::SessionDeactivated),
            (self.system_suspended, SessionPauseReason::SystemSuspended),
        ]
        .into_iter()
        .filter_map(|(on, reason)| on.then_some(reason))
        .collect()
    }
}

/// The scripted state at `elapsed_ms`, stamped `sampled_at: now_ms`; `None` when the
/// scenario scripts no timeline.
#[must_use]
pub fn state_at(marks: &[SessionMark], elapsed_ms: u64, now_ms: u64) -> Option<SessionState> {
    if marks.is_empty() {
        return None;
    }
    let mut due: Vec<&SessionMark> = marks.iter().filter(|m| m.t_ms <= elapsed_ms).collect();
    due.sort_by_key(|mark| mark.t_ms);
    let mut fields = Fields::START;
    for mark in due {
        fields.apply(mark);
    }
    Some(SessionState {
        screen_locked: Tristate::Known(fields.screen_locked),
        display_asleep: Tristate::Known(fields.display_asleep),
        user_active: UserActive {
            active: Tristate::Known(false),
            last_input_age_ms: None,
        },
        secure_input_active: Tristate::Known(fields.secure_input_active),
        session_active: Tristate::Known(fields.session_active),
        screensaver_active: Tristate::Known(fields.screensaver_active),
        pause_reasons: fields.pause_reasons(),
        sampled_at: now_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mark(t_ms: u64) -> SessionMark {
        SessionMark {
            t_ms,
            screen_locked: None,
            display_asleep: None,
            session_active: None,
            screensaver_active: None,
            secure_input_active: None,
            system_suspended: None,
        }
    }

    #[test]
    fn no_timeline_scripts_nothing() {
        assert_eq!(state_at(&[], 10, 10), None);
    }

    #[test]
    fn marks_apply_in_time_order_once_due() {
        let lock = SessionMark {
            screen_locked: Some(true),
            ..mark(100)
        };
        let unlock = SessionMark {
            screen_locked: Some(false),
            session_active: Some(false),
            ..mark(300)
        };
        let marks = [unlock, lock];
        let before = state_at(&marks, 50, 1_050).expect("scripted");
        assert_eq!(before.screen_locked, Tristate::Known(false));
        assert_eq!(before.session_active, Tristate::Known(true));
        assert!(before.pause_reasons.is_empty());
        assert_eq!(before.sampled_at, 1_050);
        let locked = state_at(&marks, 100, 1_100).expect("scripted");
        assert_eq!(locked.screen_locked, Tristate::Known(true));
        assert_eq!(locked.pause_reasons, vec![SessionPauseReason::ScreenLocked]);
        let after = state_at(&marks, 300, 1_300).expect("scripted");
        assert_eq!(after.screen_locked, Tristate::Known(false));
        assert_eq!(
            after.pause_reasons,
            vec![SessionPauseReason::SessionDeactivated]
        );
    }

    #[test]
    fn lock_beside_deactivation_reports_both_reasons_lock_first() {
        let both = SessionMark {
            screen_locked: Some(true),
            session_active: Some(false),
            ..mark(0)
        };
        let state = state_at(&[both], 0, 0).expect("scripted");
        assert_eq!(
            state.pause_reasons,
            vec![
                SessionPauseReason::ScreenLocked,
                SessionPauseReason::SessionDeactivated
            ]
        );
    }
}
