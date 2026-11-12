//! One engine session over one backend: `session.open`, `capabilities`, `session.close` and
//! the thinnest `click` and `typeText`. Both verbs reach the backend only through the mutate
//! funnel (`crate::mutate`); consent, receipts and settle policy are added there by later rows.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};

use omo_computer_core::backend::{Backend, InputEvent, PermissionProbe, Refusal, Route};
use omo_computer_core::error::EngineCode;
use omo_computer_core::capabilities::{Capabilities, InputMode, LegacyCapabilities};
use omo_computer_core::params::{
    Button, ClickParams, Delivery, Point, ReportMode, SessionOpenParams, TypeTextParams,
};
use omo_computer_core::params::{StopPathStartParams, StopPathStopParams};
use omo_computer_core::paths::Roots;
use omo_computer_core::requests::{
    read_click, read_session_open, read_type_text, TraceMode, V1Request, Verb,
};
use omo_computer_core::methods::Method;
use omo_computer_core::results::{
    CapabilitiesReply, ExecReply, PermissionState, SessionOpened, StopPathStatus,
};
use omo_computer_core::session_state::Tristate;
use omo_computer_safety::{Call, Guard, HostAdditions, NoHolds, StopPolicy, TargetRef, Transport, VerbKind};

use crate::audit::gc::SweepTrigger;
use crate::frames::admit::frame_key;
use crate::mutate::{Funnel, Mutation, Refused};
use crate::trace::Trace;

/// `stopReason` while no stop path is armed: `session.open` arms none (`stopPath.start` does).
pub const NO_GLOBAL_LISTENER: &str = "no-global-listener";

/// An exec call with no open session: the session's bare `Closed` row.
pub const NOT_OPEN: Refusal = Refusal::bare(EngineCode::Closed);

/// A click that names no point (a ref-aimed click needs the accessibility rows): the bare
/// `InvalidTarget` row.
pub const POINT_REQUIRED: Refusal = Refusal::bare(EngineCode::InvalidTarget);

pub(crate) struct Opened {
    pub(crate) report_mode: ReportMode,
    pub(crate) tag: u64,
}

/// The session state of one engine process.
pub struct Session {
    pub(crate) backend: Box<dyn Backend>,
    pub(crate) guard: Guard,
    pub(crate) opened: Option<Opened>,
    pub(crate) funnel: Funnel,
    pub(crate) refs: crate::refs::RefRegistry,
    pub(crate) frames: crate::frames::FrameStore,
    pub(crate) epoch_events: Vec<crate::epoch::EpochChanged>,
    pub(crate) trace: Trace,
}

impl Session {
    /// A session whose stop latch lives in memory only.
    #[must_use]
    pub fn new(backend: Box<dyn Backend>) -> Self {
        Self::with_guard(backend, Guard::in_memory())
    }

    /// The engine's session: the stop marker under the per-uid STATE root of `roots`, the
    /// pre-input markers and the interaction lock under its RUNTIME root.
    #[must_use]
    pub fn for_roots(backend: Box<dyn Backend>, roots: &Roots) -> Self {
        let mut session = Self::with_guard(backend, Guard::for_roots(roots));
        session.funnel = Funnel::for_roots(roots);
        session
    }

    #[must_use]
    pub fn with_guard(backend: Box<dyn Backend>, guard: Guard) -> Self {
        Self {
            backend,
            guard,
            opened: None,
            funnel: Funnel::in_memory(),
            refs: crate::refs::RefRegistry::default(),
            frames: crate::frames::FrameStore::default(),
            epoch_events: Vec::new(),
            trace: Trace::default(),
        }
    }

    /// Opens (or re-opens) the session and answers its capabilities and a fresh resume token.
    ///
    /// # Errors
    /// `Suspended{reason}` while the stop latch is set (a marker at start included).
    pub fn open(&mut self, params: SessionOpenParams) -> Result<SessionOpened, Refusal> {
        let request = read_session_open(params);
        let policy = StopPolicy::read(Transport::Local, request.allow_host_relay_only_stop);
        self.opened = None;
        self.guard.open(policy, HostAdditions::default())?;
        self.opened = Some(Opened {
            report_mode: request.report_mode,
            tag: random_u64(),
        });
        let resume_token = format!("{:016x}{:016x}", random_u64(), random_u64());
        self.funnel.set_session_id(resume_token[..16].to_owned());
        self.funnel.sweep(SweepTrigger::Open);
        let trace_dir = self.artifacts().map(|store| store.dir().to_owned());
        self.trace = Trace::open(
            request.trace.unwrap_or(TraceMode::Off),
            trace_dir,
            &resume_token[..16],
            crate::audit::now_ms(),
        );
        Ok(SessionOpened {
            capabilities: self.capabilities(),
            resume_token,
        })
    }

    /// `stopPath.start`: arms (or re-arms a parked) stop listener.
    pub fn stop_path_start(&mut self, params: StopPathStartParams) -> StopPathStatus {
        let StopPathStartParams { chord: _ } = params;
        self.guard.start_on(self.backend.as_mut())
    }

    /// `stopPath.stop{source}`: latches and commits the stop.
    pub fn stop_path_stop(&mut self, params: StopPathStopParams) -> StopPathStatus {
        self.guard.stop(params.source.as_deref(), &mut NoHolds).1
    }

    /// `stopPath.heartbeat` from the session's host.
    pub fn stop_path_heartbeat(&mut self) {
        self.guard.heartbeat();
    }

    #[must_use]
    pub fn stop_path_status(&self) -> StopPathStatus {
        self.guard.status()
    }

    /// The capabilities in the open session's report mode; with no session, the v1 shape.
    #[must_use]
    pub fn capabilities(&self) -> CapabilitiesReply {
        let mut capabilities = self.backend.capabilities();
        self.guard.describe(&mut capabilities.stop_path);
        match self.opened.as_ref().map(|opened| opened.report_mode) {
            Some(ReportMode::Object) => CapabilitiesReply::Object(Box::new(capabilities)),
            Some(ReportMode::Null) | None => CapabilitiesReply::Legacy(Box::new(legacy_capabilities(
                &capabilities,
                &self.backend.probe_permissions(),
            ))),
        }
    }

    pub fn close(&mut self) {
        if self.opened.take().is_some() {
            self.funnel.sweep(SweepTrigger::IdleExit);
            if let Err(error) = self.trace.close(crate::audit::now_ms()) {
                eprintln!("omo-computer-engine: warn trace manifest not finalised: {error}");
            }
        }
    }

    /// The point is in the coordinate space of the frame the call names (or the target's
    /// latest); the frame check runs in the funnel, and the point sent is the one the frame
    /// record maps it to.
    ///
    /// # Errors
    /// [`NOT_OPEN`], [`POINT_REQUIRED`], or the funnel's refusal.
    pub fn click(&mut self, params: ClickParams) -> Result<ExecReply, Refused> {
        let dispatched = serde_json::to_value(&params).unwrap_or_default();
        let request = read_click(params);
        let Verb::Click {
            at,
            button,
            count,
            modifiers,
            consume,
        } = request.verb
        else {
            unreachable!("read_click always reads a click");
        };
        let at = at.ok_or(POINT_REQUIRED)?;
        let key = frame_key(request.target.as_deref());
        let (point, frame_refusal, consumes) =
            match self.admit_frame(&key, request.frame_id.as_deref(), at.x, at.y) {
                Ok(admitted) => (
                    admitted.point,
                    None,
                    consume.then(|| (key.clone(), admitted.frame_id)),
                ),
                Err(refusal) => (Point { x: at.x, y: at.y }, Some(refusal), None),
            };
        let call = Call {
            verb: VerbKind::Pointer,
            target: TargetRef::read(request.target.as_deref()),
            points: vec![point],
            chord: None,
            force: false,
        };
        let route = route_for(request.target.as_deref(), request.policy.delivery);
        let button = button.unwrap_or(Button::Left);
        let mut events = vec![InputEvent::PointerMove(point)];
        events.extend(modifiers.iter().map(|key| key_event(key, true)));
        for _ in 0..count.unwrap_or(1) {
            events.push(InputEvent::Button { button, down: true });
            events.push(InputEvent::Button { button, down: false });
        }
        events.extend(modifiers.iter().rev().map(|key| key_event(key, false)));
        let result = self.mutate(
            Mutation::exec(Method::Click, call, events, route, &request.authority)
                .with_frame(request.frame_id.clone())
                .with_frame_check(frame_refusal, consumes)
                .with_keys(modifiers),
        );
        self.trace_turn(Method::Click, dispatched, &key, &result);
        result
    }

    /// # Errors
    /// [`NOT_OPEN`] or the funnel's refusal.
    pub fn type_text(&mut self, params: TypeTextParams) -> Result<ExecReply, Refused> {
        let dispatched = serde_json::to_value(&params).unwrap_or_default();
        let V1Request::TypeText { target, text } = read_type_text(params) else {
            unreachable!("read_type_text always reads a typeText");
        };
        let call = Call {
            verb: VerbKind::Keyboard,
            target: TargetRef::read(Some(target.as_str())),
            points: Vec::new(),
            chord: None,
            force: false,
        };
        let route = route_for(Some(target.as_str()), None);
        let result = self.mutate(Mutation::typed(Method::TypeText, call, route, text));
        self.trace_turn(Method::TypeText, dispatched, &target, &result);
        result
    }
}

fn key_event(key: &str, down: bool) -> InputEvent {
    InputEvent::Key {
        key: key.to_owned(),
        down,
    }
}

/// A call aimed at a window goes to that window in the background unless it asks for the
/// foreground; a call with no target can only reach the foreground.
fn route_for(target: Option<&str>, delivery: Option<Delivery>) -> Route {
    match (target, delivery) {
        (Some(_), None | Some(Delivery::Background)) => Route::BackgroundWindow,
        (None, _) | (Some(_), Some(Delivery::Foreground)) => Route::ForegroundHid,
    }
}

fn random_u64() -> u64 {
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u32(std::process::id());
    hasher.finish()
}

const fn permission(state: PermissionState) -> &'static str {
    match state {
        PermissionState::Granted => "granted",
        PermissionState::Denied => "denied",
        PermissionState::Unknown => "unknown",
    }
}

const fn known_true(state: Tristate) -> bool {
    matches!(state, Tristate::Known(true))
}

/// The v1 record a null-mode session reads, projected from the object-mode capabilities.
#[must_use]
pub fn legacy_capabilities(caps: &Capabilities, probe: &PermissionProbe) -> LegacyCapabilities {
    LegacyCapabilities {
        backend: caps.backend.clone(),
        display_server: None,
        capture: caps.capture.available,
        input: caps.window_input.available,
        ax: caps.input_modes.contains(&InputMode::Ax),
        background_window_input: caps.background_window_input,
        cursor_overlay: false,
        delivery_modes: caps.delivery_modes.clone(),
        capture_permission: permission(probe.capture).to_owned(),
        input_permission: permission(probe.input).to_owned(),
        ax_permission: permission(probe.accessibility).to_owned(),
        display_count: caps.display_count,
        focus_guard: caps.background_window_input,
        stop_path: "none".to_owned(),
        stop_reason: Some(NO_GLOBAL_LISTENER.to_owned()),
        integrity_level: None,
        screen_locked: known_true(caps.session.screen_locked),
        display_asleep: Some(known_true(caps.session.display_asleep)),
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_backend_fake::{FakeBackend, FakeScenario, RecordingSink, StopPathScript};
    use serde_json::json;

    use super::*;

    const ONE_WINDOW: &str = r#"{"windows":[{"id":"1","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":100,"height":100,"focused":true,"elevated":null}]}"#;

    fn session(sink: &RecordingSink) -> Session {
        let scenario = FakeScenario::from_json(ONE_WINDOW).expect("scenario");
        let clock = omo_computer_backend_fake::FakeClock::default();
        let backend = FakeBackend::with_parts(scenario, clock, sink.clone());
        Session::new(Box::new(backend.with_stop_path(StopPathScript::Live)))
    }

    fn start(session: &mut Session) {
        session.stop_path_start(params(json!({})));
    }

    fn params<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> T {
        serde_json::from_value(value).expect("params parse")
    }

    #[test]
    fn exec_before_open_sends_nothing() {
        let sink = RecordingSink::default();
        let mut session = session(&sink);
        let result = session.type_text(params(json!({"target": "1", "text": "hi"})));
        assert_eq!(result, Err(NOT_OPEN.into()));
        assert!(sink.is_empty());
        assert!(NOT_OPEN.computer_code().is_ok() && POINT_REQUIRED.computer_code().is_ok());
    }

    #[test]
    fn null_mode_click_posts_and_replies_null() {
        let sink = RecordingSink::default();
        let mut session = session(&sink);
        session.open(params(json!({}))).expect("open");
        start(&mut session);
        session.capture_frame("1", true, None).expect("a frame of 1");
        let reply = session.click(params(json!({"target": "1", "x": 3, "y": 4})));
        assert_eq!(reply, Ok(ExecReply(None)));
        assert_eq!(sink.len(), 3, "move, down, up: {:?}", sink.lines());
        assert!(sink.lines().iter().all(|line| line.contains("route=backgroundwindow")));
    }

    #[test]
    fn object_mode_reads_object_capabilities_and_close_ends_the_session() {
        let sink = RecordingSink::default();
        let mut session = session(&sink);
        let opened = session.open(params(json!({"reportMode": "object"}))).expect("open");
        assert!(matches!(opened.capabilities, CapabilitiesReply::Object(_)));
        assert_eq!(opened.resume_token.len(), 32);
        session.close();
        assert!(matches!(session.capabilities(), CapabilitiesReply::Legacy(_)));
        let after = session.type_text(params(json!({"target": "1", "text": "x"})));
        assert_eq!(after, Err(NOT_OPEN.into()));
    }
}
