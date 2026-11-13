//! The user-wins-every-race vocabulary: the takeover window, the pause entries a call and a
//! run report, and the target-liveness member of a report (contract acceptance 19, 77, 78,
//! 96; `design/d-safety.md` '3. Human input detection' and '5. Screen lock and secure
//! desktop').

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Physical input in the frontmost target within this window holds the send (the takeover gate).
pub const TAKEOVER_WINDOW_MS: u64 = 1_500;

/// The intervention record's per-app quiet window: the most a run's deadline is paused per
/// takeover refusal.
pub const QUIET_WINDOW_MS: u64 = 5_000;

/// The default of `computer.pause_ceiling_ms`: a pause that lasts longer ends the call typed.
pub const DEFAULT_PAUSE_CEILING_MS: u64 = 120_000;

/// The default of `computer.display_awake_grace_ms` (design/d-loop-migration.md:72).
pub const DEFAULT_DISPLAY_AWAKE_GRACE_MS: u64 = 60_000;

/// The default of `computer.display_awake_session_cap_ms` (design/d-loop-migration.md:72).
pub const DEFAULT_DISPLAY_AWAKE_SESSION_CAP_MS: u64 = 14_400_000;

/// How often a paused admission re-samples the session state and the stop path.
pub const PAUSE_TICK_MS: u64 = 100;

/// Why a call (or a run) waited before it was admitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PauseReason {
    /// The user worked in the frontmost target within [`TAKEOVER_WINDOW_MS`].
    UserActive,
    ScreenLocked,
    /// A local hand's system went to sleep.
    SystemSuspended,
}

/// One pause: `ActionReport.paused[]` per call, `RunResult.pauses[]` per run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pause {
    pub reason: PauseReason,
    /// Milliseconds on the hand's clock the admission waited for this reason.
    pub ms: u64,
}

/// The state of a target whose process stopped serving the call. A healthy target has no
/// `target` member at all: `running` is never emitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TargetState {
    Exited,
    /// The process stopped answering (AX / bus / message timeout).
    Unresponsive,
}

/// `ActionReport.target`: present only when the target exited or stopped answering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetLiveness {
    pub state: TargetState,
    pub pid: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal: Option<i32>,
}

/// What one interruptible text stroke delivered: `sent` of `of` Unicode scalars, and the
/// refusal or the interruption that ended it early.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextDelivery {
    pub sent: u32,
    pub of: u32,
    pub refusal: Option<crate::backend::Refusal>,
    pub interrupted: bool,
}

/// A backend's monotonic clock in milliseconds, and its wait.
pub trait BackendClock {
    fn now_ms(&self) -> u64;
    /// Waits `ms` on this clock (a fake clock just advances).
    fn wait_ms(&self, ms: u64);
}

/// What a backend reads for the user-wins-every-race stages.
pub trait InterventionSource {
    /// The pid of the frontmost application, when it can be read.
    fn frontmost_pid(&self) -> Option<u32>;
    /// The clock time of the last PHYSICAL input in `pid` the foreign filter saw.
    fn last_user_input_ms(&self, pid: u32) -> Option<u64>;
    /// The window's process when it exited or stopped answering; `None` while healthy.
    fn target_liveness(&self, window: &str) -> Option<TargetLiveness>;
    /// The session state the backend's probes read now, over its capability vector's.
    fn session_state(&self) -> Option<crate::session_state::SessionState>;
}

/// The number of Unicode scalars `text` types: the unit of `delivered{count, of}`.
#[must_use]
pub fn scalars(text: &str) -> u32 {
    u32::try_from(text.chars().count()).unwrap_or(u32::MAX)
}

/// Whether physical input at `last_input_ms` holds a send at `now_ms`.
#[must_use]
pub const fn within_takeover_window(last_input_ms: u64, now_ms: u64) -> bool {
    now_ms.saturating_sub(last_input_ms) < TAKEOVER_WINDOW_MS
}

/// The refusing defaults of the `Backend` reads row 22 adds.
#[cfg(test)]
mod backend_default_tests {
    use std::cell::Cell;

    use crate::backend::{Backend, BackendResult, Delivered, InputEvent, Refusal, Route, TaggedInput};
    use crate::error::EngineCode;

    use super::TextDelivery;

    #[derive(Default)]
    struct Bare {
        posted: Vec<InputEvent>,
        refuse: bool,
    }

    impl Backend for Bare {
        fn post_input(&mut self, input: &TaggedInput, _route: Route) -> BackendResult<Delivered> {
            if self.refuse {
                return Err(Refusal::bare(EngineCode::InputFailed));
            }
            self.posted.push(input.event.clone());
            Ok(Delivered { count: 1, of: 1 })
        }
    }

    #[test]
    fn a_backend_without_overrides_has_no_clock_and_no_intervention_reads() {
        let bare = Bare::default();
        assert!(bare.clock().is_none());
        assert!(bare.intervention().is_none());
    }

    #[test]
    fn default_post_text_is_one_uninterruptible_post_input() {
        let mut bare = Bare::default();
        let asked = Cell::new(0);
        let mut interrupt = |_: &dyn Backend| {
            asked.set(asked.get() + 1);
            true
        };
        let delivery = bare.post_text("hello", Route::BackgroundWindow, 7, &mut interrupt);
        assert_eq!(
            delivery,
            TextDelivery {
                sent: 5,
                of: 5,
                refusal: None,
                interrupted: false
            }
        );
        assert_eq!(asked.get(), 0, "the default never asks");
        assert_eq!(bare.posted, vec![InputEvent::Text("hello".to_owned())]);
    }

    #[test]
    fn default_post_text_reports_the_refusal_with_nothing_sent() {
        let mut bare = Bare {
            refuse: true,
            ..Bare::default()
        };
        let delivery = bare.post_text("hi", Route::BackgroundWindow, 7, &mut |_| false);
        assert_eq!((delivery.sent, delivery.of), (0, 2));
        assert_eq!(delivery.refusal, Some(Refusal::bare(EngineCode::InputFailed)));
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn report_parts() -> crate::report::ReportParts {
        crate::report::ReportParts {
            disposition: crate::report::Disposition::DELIVERED_UNVERIFIED,
            delivered: None,
            effect: crate::report::Effect::Unverifiable,
            route: crate::report::Route::BackgroundWindow,
            hit: None,
            focus_restoration: None,
            opened_surfaces: Vec::new(),
            next_call: None,
            note: None,
            reason: None,
            nothing_sent: None,
            warning: None,
            audit_ids: Vec::new(),
            timings: None,
            evidence: Vec::new(),
            url_policy: None,
            observation: crate::untrusted::UntrustedText,
            paused: Vec::new(),
            session: None,
            target: None,
        }
    }

    fn context() -> crate::report::ReportContext {
        crate::report::ReportContext::new(crate::report::VerbClass::Action, None)
    }

    #[test]
    fn a_report_without_pauses_session_or_target_omits_the_three_members() {
        let report = crate::report::ActionReport::new(context(), report_parts()).expect("valid");
        let value = serde_json::to_value(&report).expect("json");
        for member in ["paused", "session", "target"] {
            assert!(value.get(member).is_none(), "{member}: {value}");
        }
        assert!(report.paused().is_empty() && report.session().is_none() && report.target().is_none());
    }

    #[test]
    fn a_report_with_pauses_session_and_target_round_trips_the_wire() {
        let parts = crate::report::ReportParts {
            paused: vec![Pause {
                reason: PauseReason::ScreenLocked,
                ms: 5_000,
            }],
            session: Some(crate::backend::unknown_session_state()),
            target: Some(TargetLiveness {
                state: TargetState::Exited,
                pid: 9,
                exit_code: None,
                signal: Some(9),
            }),
            ..report_parts()
        };
        let report = crate::report::ActionReport::new(context(), parts).expect("valid");
        let value = serde_json::to_value(&report).expect("json");
        assert_eq!(value["paused"], json!([{"reason": "screen_locked", "ms": 5000}]));
        assert_eq!(value["target"], json!({"state": "exited", "pid": 9, "signal": 9}));
        assert_eq!(value["session"]["screenLocked"], json!("unknown"));
        let parsed: crate::report::ActionReport =
            serde_json::from_value(value).expect("the wire parse keeps the members");
        assert_eq!(parsed, report);
    }

    #[test]
    fn scalars_count_unicode_scalars_not_bytes() {
        assert_eq!(scalars("abc"), 3);
        assert_eq!(scalars("\u{d55c}\u{ae00}"), 2);
        assert_eq!(scalars(""), 0);
    }

    #[test]
    fn takeover_window_holds_200_ms_and_releases_at_1500_ms() {
        assert!(within_takeover_window(10_000, 10_200));
        assert!(within_takeover_window(10_000, 11_499));
        assert!(!within_takeover_window(10_000, 11_500));
        assert!(!within_takeover_window(10_000, 11_600));
    }

    #[test]
    fn pause_and_target_wire_shapes() {
        let pause = Pause {
            reason: PauseReason::UserActive,
            ms: 1_500,
        };
        assert_eq!(
            serde_json::to_value(pause).ok(),
            Some(json!({"reason": "user_active", "ms": 1500}))
        );
        let exited = TargetLiveness {
            state: TargetState::Exited,
            pid: 4242,
            exit_code: Some(0),
            signal: None,
        };
        assert_eq!(
            serde_json::to_value(exited).ok(),
            Some(json!({"state": "exited", "pid": 4242, "exitCode": 0}))
        );
        let parsed: Result<TargetLiveness, _> =
            serde_json::from_value(json!({"state": "running", "pid": 1}));
        assert!(parsed.is_err(), "running is never a target state");
    }
}
