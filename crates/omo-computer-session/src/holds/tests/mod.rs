//! Row 23 on the fake, through the host-call route the engine takes: the exit-path ledger,
//! the hold bound, the foreground rule, drags and bounded scrolls.

mod click;
mod exit_paths;
mod pointer;

use omo_computer_backend_fake::{FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript};
use omo_computer_core::backend::{
    Backend, BackendResult, Delivered, PermissionProbe, Refusal, Route, StopListener, TaggedInput, WindowFilter,
    WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::error::EngineCode;
use omo_computer_core::methods::Method;
use serde_json::{json, Value};

use crate::grant::HostCallError;
use crate::{Refused, Session};

pub(super) const WINDOWS: &str = r#""windows":[{"id":"101","title":"t","app":"Notes","pid":4242,"x":0,"y":0,"width":800,"height":600,"focused":true,"elevated":null}]"#;

pub(super) struct Fixture {
    pub(super) session: Session,
    pub(super) sink: RecordingSink,
    pub(super) clock: FakeClock,
}

/// An object-mode session on the fake (`extra` adds scenario members), stop path armed.
pub(super) fn fixture(extra: &str, refuse_at: Option<usize>) -> Fixture {
    let sink = RecordingSink::default();
    let clock = FakeClock::default();
    let scenario = FakeScenario::from_json(&format!("{{{WINDOWS}{extra}}}")).expect("scenario");
    let fake = FakeBackend::with_parts(scenario, clock.clone(), sink.clone()).with_stop_path(StopPathScript::Live);
    let backend: Box<dyn Backend> = match refuse_at {
        Some(at) => Box::new(RefuseAt { inner: fake, at, posts: 0 }),
        None => Box::new(fake),
    };
    let mut session = Session::new(backend);
    session.open(serde_json::from_value(json!({"reportMode": "object"})).expect("open params")).expect("open");
    session.stop_path_start(serde_json::from_value(json!({})).expect("start params"));
    Fixture { session, sink, clock }
}

impl Fixture {
    pub(super) fn grant(&mut self) {
        self.session.control_grant(serde_json::from_value(json!({"reason": "test"})).expect("grant params"));
    }

    /// One row-23 call on the host-call route.
    pub(super) fn call(&mut self, method: Method, params: Value) -> Result<Value, Refused> {
        match self.session.host_call(method, params) {
            Some(Ok(value)) => Ok(value),
            Some(Err(HostCallError::Refused(refused))) => Err(refused),
            Some(Err(HostCallError::Params(error))) => panic!("{method:?} params: {error}"),
            None => panic!("row 23 serves {method:?} on the host-call route"),
        }
    }

    pub(super) fn frame(&mut self) -> String {
        self.session.capture_frame("101", true, None).expect("capture").frame_id
    }

    /// The sink lines that post input.
    pub(super) fn inputs(&self) -> Vec<String> {
        self.sink.lines().into_iter().filter(|line| line.starts_with("post_input")).collect()
    }
}

pub(super) fn ends_with(line: &str, tail: &str) -> bool {
    line.ends_with(tail)
}

pub(super) fn reason(refused: &Refused) -> (&'static str, Option<&'static str>) {
    (refused.refusal.code.wire(), refused.refusal.reason)
}

/// The fake, refusing the `at`-th input post (0-based) the way a stopped or failing route does.
struct RefuseAt {
    inner: FakeBackend,
    at: usize,
    posts: usize,
}

impl Backend for RefuseAt {
    fn capabilities(&self) -> Capabilities {
        self.inner.capabilities()
    }

    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.inner.windows(filter)
    }

    fn displays(&mut self) -> BackendResult<Vec<omo_computer_core::results::DisplayInfo>> {
        self.inner.displays()
    }

    fn capture(
        &mut self,
        target: &omo_computer_core::backend::Target,
        options: &omo_computer_core::backend::CaptureOptions,
    ) -> BackendResult<omo_computer_core::backend::FrameBytes> {
        self.inner.capture(target, options)
    }

    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        let index = self.posts;
        self.posts += 1;
        if index == self.at {
            return Err(Refusal::bare(EngineCode::InputFailed));
        }
        self.inner.post_input(input, route)
    }

    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        self.inner.stop_listener()
    }

    fn probe_permissions(&self) -> PermissionProbe {
        self.inner.probe_permissions()
    }

    fn epoch_source(&mut self) -> Box<dyn omo_computer_core::backend::EpochSource> {
        self.inner.epoch_source()
    }

    fn presence(&mut self) -> Option<Box<dyn omo_computer_core::backend::Presence>> {
        self.inner.presence()
    }

    fn clock(&self) -> Option<&dyn omo_computer_core::intervention::BackendClock> {
        Backend::clock(&self.inner)
    }
}
