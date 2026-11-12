//! Row 22 on the fake: the exact `delivered{count, of}` of an interrupted text, the takeover
//! pause before a send, and a target that exits mid-text.

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::backend::{
    Backend, BackendResult, Delivered, PermissionProbe, Route, StopListener, TaggedInput,
    WindowFilter, WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::intervention::{
    BackendClock, InterventionSource, Pause, PauseReason, TargetLiveness, TargetState,
    TextDelivery,
};
use omo_computer_core::report::Disposition;
use omo_computer_core::results::ExecReply;
use serde_json::json;

use crate::{Refused, Session};

pub(crate) const WINDOW: &str = r#""windows":[{"id":"101","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}]"#;

pub(crate) fn fake(extra: &str) -> (FakeBackend, RecordingSink) {
    let sink = RecordingSink::default();
    let scenario = FakeScenario::from_json(&format!("{{{WINDOW}{extra}}}")).expect("scenario");
    let backend = FakeBackend::with_parts(scenario, FakeClock::default(), sink.clone())
        .with_stop_path(StopPathScript::Live);
    (backend, sink)
}

pub(crate) fn params<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
    serde_json::from_value(value).expect("params parse")
}

/// An object-mode session over `backend` with the stop path armed.
pub(crate) fn object_session(backend: Box<dyn Backend>) -> Session {
    let mut session = Session::new(backend);
    session
        .open(params(json!({"reportMode": "object"})))
        .expect("open");
    session.stop_path_start(params(json!({})));
    session
}

pub(crate) fn wire(refused: &Refused) -> (&'static str, Option<&'static str>) {
    (refused.refusal.code.wire(), refused.refusal.reason)
}

pub(crate) fn report(reply: ExecReply) -> omo_computer_core::report::ActionReport {
    reply.0.expect("an object-mode reply carries the ActionReport")
}

/// A click on window 101 that names a frame of it captured first (row 20's frame rule, R25);
/// when the capture itself is refused the click goes without one, so an earlier stage answers.
/// A foreground click takes row 21's human grant first.
pub(crate) trait FramedClick {
    fn framed_click(&mut self, delivery: Option<&str>) -> Result<ExecReply, Refused>;
}

impl FramedClick for Session {
    fn framed_click(&mut self, delivery: Option<&str>) -> Result<ExecReply, Refused> {
        let mut call = json!({"target": "101", "x": 10, "y": 10});
        if let Ok(frame) = self.capture_frame("101", true, None) {
            call["frameId"] = json!(frame.frame_id);
        }
        if let Some(delivery) = delivery {
            if delivery == "foreground" {
                // Row 21: foreground delivery needs the human grant first (AC-12).
                self.control_grant(params(json!({ "reason": "test" })));
            }
            call["delivery"] = json!(delivery);
        }
        self.click(params(call))
    }
}

#[test]
fn typetext_interrupted_reports_exact_delivered_count() {
    let (backend, sink) = fake(
        r#","typing_unit_ms":10,"user_input_timeline":[{"t_ms":25,"pid":4242,"kind":"key"}]"#,
    );
    let mut session = object_session(Box::new(backend));
    let refused = session
        .type_text(params(json!({"target": "101", "text": "abcdefghij"})))
        .expect_err("the user pressed a key after the third grapheme");
    assert_eq!(wire(&refused), ("UserIntervened", None));
    assert_eq!(refused.stamps.delivered, Some(Delivered { count: 3, of: 10 }));
    assert_eq!(refused.interrupted, None, "the code's PREFIX row says it");
    assert_eq!(sink.len(), 1, "one stroke, nothing after: {:?}", sink.lines());
    assert!(sink.lines()[0].ends_with(r#"text "abc""#), "{:?}", sink.lines());
}

#[test]
fn intervention_continue_never_aborts_the_stroke() {
    let (backend, sink) = fake(
        r#","typing_unit_ms":10,"user_input_timeline":[{"t_ms":25,"pid":4242,"kind":"key"}]"#,
    );
    let mut session = Session::new(Box::new(backend));
    session
        .open(params(json!({"reportMode": "object", "intervention": "continue"})))
        .expect("open");
    session.stop_path_start(params(json!({})));
    let reply = session
        .type_text(params(json!({"target": "101", "text": "abcdefghij"})))
        .expect("continue sends every grapheme");
    assert_eq!(report(reply).delivered(), Some(omo_computer_core::report::Delivered { count: 10, of: 10 }));
    assert!(sink.lines()[0].ends_with(r#"text "abcdefghij""#));
}

#[test]
fn user_active_200ms_before_send_pauses_instead_of_sending() {
    let (backend, sink) = fake(r#","user_input_timeline":[{"t_ms":800,"pid":4242,"kind":"key"}]"#);
    backend.clock().advance(1_000);
    let mut session = object_session(Box::new(backend));
    let reply = session
        .framed_click(None)
        .expect("sends once the user paused for 1500 ms");
    let first = report(reply);
    assert_eq!(
        first.paused(),
        &[Pause {
            reason: PauseReason::UserActive,
            ms: 1_300
        }]
    );
    assert_eq!(sink.len(), 3, "sent after the pause: {:?}", sink.lines());

    let (backend, sink) = fake(r#","user_input_timeline":[{"t_ms":0,"pid":4242,"kind":"key"}]"#);
    backend.clock().advance(1_600);
    let reply = object_session(Box::new(backend))
        .framed_click(None)
        .expect("1600 ms before sends at once");
    assert!(report(reply).paused().is_empty());
    assert_eq!(sink.len(), 3);

    let steady: Vec<String> = (0..=125)
        .map(|second| format!(r#"{{"t_ms":{},"pid":4242,"kind":"key"}}"#, second * 1_000))
        .collect();
    let (backend, sink) = fake(&format!(r#","user_input_timeline":[{}]"#, steady.join(",")));
    let refused = object_session(Box::new(backend))
        .framed_click(None)
        .expect_err("the user never paused within the ceiling");
    assert_eq!(wire(&refused), ("UserIntervened", None));
    assert_eq!(refused.stamps.paused.first().map(|p| p.reason), Some(PauseReason::UserActive));
    assert!(refused.stamps.paused[0].ms > 120_000);
    assert_eq!(refused.stamps.delivered, None, "nothing was sent");
    assert!(sink.is_empty(), "{:?}", sink.lines());
}

#[test]
fn null_mode_never_pauses_a_v1_call() {
    let (backend, sink) = fake(r#","user_input_timeline":[{"t_ms":800,"pid":4242,"kind":"key"}]"#);
    let clock = backend.clock();
    clock.advance(1_000);
    let mut session = Session::new(Box::new(backend));
    session.open(params(json!({}))).expect("open");
    session.stop_path_start(params(json!({})));
    let reply = session.framed_click(None);
    assert_eq!(reply, Ok(ExecReply(None)));
    assert_eq!(clock.now_ms(), 1_000, "no wait in a null-mode session");
    assert_eq!(sink.len(), 3);
}

/// The fake, with its window's process exiting once the clock passes `exit_at_ms`.
struct ExitsAt {
    inner: FakeBackend,
    exit_at_ms: u64,
}

impl ExitsAt {
    fn liveness(clock: &FakeClock, exit_at_ms: u64) -> Option<TargetLiveness> {
        (clock.now_ms() >= exit_at_ms).then_some(TargetLiveness {
            state: TargetState::Exited,
            pid: 4242,
            exit_code: Some(1),
            signal: None,
        })
    }
}

impl Backend for ExitsAt {
    fn capabilities(&self) -> Capabilities {
        self.inner.capabilities()
    }
    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.inner.windows(filter)
    }
    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        self.inner.post_input(input, route)
    }
    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        self.inner.stop_listener()
    }
    fn probe_permissions(&self) -> PermissionProbe {
        self.inner.probe_permissions()
    }
    fn clock(&self) -> Option<&dyn BackendClock> {
        Backend::clock(&self.inner)
    }
    fn intervention(&self) -> Option<&dyn InterventionSource> {
        Some(self)
    }
    fn post_text(
        &mut self,
        text: &str,
        route: Route,
        tag: u64,
        interrupt: &mut dyn FnMut(&dyn Backend) -> bool,
    ) -> TextDelivery {
        let (clock, exit_at_ms) = (self.inner.clock(), self.exit_at_ms);
        let mut exits = |backend: &dyn Backend| {
            Self::liveness(&clock, exit_at_ms).is_some() || interrupt(backend)
        };
        self.inner.post_text(text, route, tag, &mut exits)
    }
}

impl InterventionSource for ExitsAt {
    fn frontmost_pid(&self) -> Option<u32> {
        self.inner.intervention()?.frontmost_pid()
    }
    fn last_user_input_ms(&self, pid: u32) -> Option<u64> {
        self.inner.intervention()?.last_user_input_ms(pid)
    }
    fn target_liveness(&self, _window: &str) -> Option<TargetLiveness> {
        Self::liveness(&self.inner.clock(), self.exit_at_ms)
    }
    fn session_state(&self) -> Option<omo_computer_core::session_state::SessionState> {
        self.inner.intervention()?.session_state()
    }
}

#[test]
fn target_exits_mid_type_reports_exited() {
    let (inner, sink) = fake(r#","typing_unit_ms":10"#);
    let mut session = object_session(Box::new(ExitsAt {
        inner,
        exit_at_ms: 25,
    }));
    let refused = session
        .type_text(params(json!({"target": "101", "text": "abcdefghij"})))
        .expect_err("the process exited after the third grapheme");
    assert_eq!(wire(&refused), ("WindowNotFound", None));
    assert_eq!(refused.stamps.delivered, Some(Delivered { count: 3, of: 10 }));
    assert_eq!(refused.interrupted, Some(Disposition::UNCERTAIN_UNSAFE));
    let target = refused.stamps.target.expect("the exited target");
    assert_eq!(
        (target.state, target.pid, target.exit_code),
        (TargetState::Exited, 4242, Some(1))
    );
    assert_eq!(sink.len(), 1);
}

#[test]
fn a_window_that_crashed_before_admission_is_window_not_found_with_nothing_sent() {
    let (backend, sink) = fake(
        r#","target_exit":[{"after_call":"windows","window":"101","exit_code":0}]"#,
    );
    let mut backend = backend;
    assert!(backend.windows(&WindowFilter::default()).is_ok(), "the read that fires the exit");
    let refused = object_session(Box::new(backend))
        .framed_click(None)
        .expect_err("crashed");
    assert_eq!(wire(&refused), ("WindowNotFound", None));
    assert_eq!(refused.stamps.target, None);
    assert!(sink.is_empty());
}

#[test]
fn a_healthy_call_carries_no_target_member() {
    let (backend, _sink) = fake("");
    let reply = object_session(Box::new(backend))
        .framed_click(None)
        .expect("healthy");
    let value = serde_json::to_value(report(reply)).expect("json");
    assert!(value.get("target").is_none(), "{value}");
    assert!(value.get("session").is_some(), "object mode stamps the session: {value}");
}

#[test]
fn a_foreground_lease_ending_releases_the_display_awake_hold_and_nothing_reacquires_it() {
    let (backend, _sink) = fake("");
    let mut session = object_session(Box::new(backend));
    assert!(session.framed_click(None).is_ok(), "the click delivered");
    assert!(session.display_awake.holds_display_awake(), "an exec acquires the hold");
    // Row 21's foreground lease, then the lease ends under the user.
    session.control_grant(params(json!({ "reason": "test" })));
    session.control_release();
    assert_eq!(
        session.display_awake,
        crate::intervention::DisplayAwakeHold::Released,
        "the lease ending releases the hold"
    );
    assert!(session.framed_click(None).is_ok(), "background click still delivers");
    assert!(
        !session.display_awake.holds_display_awake(),
        "nothing re-acquires the hold after the lease ended"
    );
}

#[test]
fn an_exec_after_session_open_acquires_the_display_awake_hold() {
    let (backend, _sink) = fake("");
    let mut session = object_session(Box::new(backend));
    assert_eq!(
        session.display_awake,
        crate::intervention::DisplayAwakeHold::Idle,
        "session.open leaves the hold idle, not parked"
    );
    assert!(session.framed_click(None).is_ok(), "the click delivered");
    assert!(session.display_awake.holds_display_awake(), "the exec acquires the hold");
}
