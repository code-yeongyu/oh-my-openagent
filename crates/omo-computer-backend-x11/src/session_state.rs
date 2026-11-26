//! The X11 `SessionState` probes (row 50; design row L13's X11 half): the screen saver as the
//! MIT-SCREEN-SAVER extension reports it, the session's lock as login1 `LockedHint` reports it,
//! and DPMS for display sleep. Each reads `"unknown"` when its source did not answer, which never
//! refuses; a locked or saver-active session pauses.

use omo_computer_core::backend::unknown_session_state;
use omo_computer_core::session_state::{SessionPauseReason, SessionState, Tristate};

/// The raw reads; `None` is a source that did not answer.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SessionReads {
    pub saver_on: Option<bool>,
    pub locked_hint: Option<bool>,
    pub session_active: Option<bool>,
    pub dpms_off: Option<bool>,
    pub idle_ms: Option<u64>,
}

fn tristate(value: Option<bool>) -> Tristate {
    value.map_or_else(|| unknown_session_state().screen_locked, Tristate::Known)
}

/// A user counts as active when the server saw input within this window.
pub const ACTIVE_WITHIN_MS: u64 = 60_000;

#[must_use]
pub fn session_state(reads: SessionReads, sampled_at: u64) -> SessionState {
    let mut state = unknown_session_state();
    state.screen_locked = tristate(reads.locked_hint);
    state.screensaver_active = tristate(reads.saver_on);
    state.session_active = tristate(reads.session_active);
    state.display_asleep = tristate(reads.dpms_off);
    state.user_active.active = tristate(reads.idle_ms.map(|idle| idle < ACTIVE_WITHIN_MS));
    state.user_active.last_input_age_ms = reads.idle_ms;
    if reads.locked_hint == Some(true) {
        state.pause_reasons.push(SessionPauseReason::ScreenLocked);
    }
    if reads.saver_on == Some(true) {
        state
            .pause_reasons
            .push(SessionPauseReason::ScreensaverActive);
    }
    if reads.session_active == Some(false) {
        state
            .pause_reasons
            .push(SessionPauseReason::SessionDeactivated);
    }
    state.sampled_at = sampled_at;
    state
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_answered_reads_unknown_and_never_pauses() {
        let state = session_state(SessionReads::default(), 7);
        let unknown = unknown_session_state();
        assert_eq!(state.screen_locked, unknown.screen_locked);
        assert_eq!(state.screensaver_active, unknown.screen_locked);
        assert!(state.pause_reasons.is_empty());
        assert_eq!(state.sampled_at, 7);
    }

    #[test]
    fn a_lock_and_a_saver_pause_and_recent_input_is_active() {
        let state = session_state(
            SessionReads {
                saver_on: Some(true),
                locked_hint: Some(true),
                session_active: Some(true),
                dpms_off: Some(false),
                idle_ms: Some(1_000),
            },
            0,
        );
        assert_eq!(state.screen_locked, Tristate::Known(true));
        assert_eq!(state.user_active.active, Tristate::Known(true));
        assert_eq!(
            state.pause_reasons,
            vec![
                SessionPauseReason::ScreenLocked,
                SessionPauseReason::ScreensaverActive
            ]
        );
    }
}
