//! The funnel's tests: a fake backend over a temp RUNTIME/STATE root, as the engine runs it.

mod batch;
mod engine_process;
mod marker;
mod poison;
mod recovery;
mod secure;
mod standalone;

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use omo_computer_backend_fake::{
    FakeBackend, FakeClock, FakeScenario, Persona, RecordingSink, StopPathScript,
};
use omo_computer_core::backend::{
    Backend, BackendResult, CaptureOptions, Delivered, EpochSource, FrameBytes, PermissionProbe,
    Presence, Route, StopListener, TaggedInput, Target, WindowFilter, WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::paths::Roots;
use omo_computer_core::results::DisplayInfo;
use serde_json::{json, Value};

use crate::{Refused, Session};

pub(super) const SCENARIO: &str =
    include_str!("../../../../omo-computer-backend-fake/fixtures/two-displays-one-window.json");

pub(super) fn params<T: serde::de::DeserializeOwned>(value: Value) -> T {
    serde_json::from_value(value).expect("params parse")
}

pub(super) fn click(call_id: &str) -> omo_computer_core::params::ClickParams {
    params(json!({ "target": "101", "x": 10, "y": 10, "callId": call_id }))
}

pub(super) fn wire(refused: &Refused) -> (&'static str, Option<&'static str>) {
    (refused.refusal.code.wire(), refused.refusal.reason)
}

/// One engine's roots in a temp dir, and the sink every backend of the test records into.
pub(super) struct Run {
    pub(super) dir: tempfile::TempDir,
    pub(super) sink: RecordingSink,
}

impl Run {
    pub(super) fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("tempdir"),
            sink: RecordingSink::default(),
        }
    }

    pub(super) fn roots(&self) -> Roots {
        Roots {
            state: self.dir.path().to_owned(),
            runtime: self.dir.path().to_owned(),
        }
    }

    pub(super) fn fake_of(&self, scenario: &str, persona: Persona) -> FakeBackend {
        let scenario = FakeScenario::from_json(scenario).expect("scenario");
        FakeBackend::with_parts(scenario, FakeClock::default(), self.sink.clone())
            .with_persona(persona)
            .with_stop_path(StopPathScript::Live)
    }

    pub(super) fn fake(&self) -> FakeBackend {
        self.fake_of(SCENARIO, Persona::host())
    }

    /// An engine session over `backend`: opened and with the stop path armed.
    pub(super) fn session(&self, backend: Box<dyn Backend>) -> Session {
        open(Session::for_roots(backend, &self.roots()))
    }

    pub(super) fn marker_file(&self) -> PathBuf {
        self.dir.path().join("markers/local/default.json")
    }

    pub(super) fn marker(&self) -> Value {
        serde_json::from_str(&fs::read_to_string(self.marker_file()).expect("a marker"))
            .expect("marker JSON")
    }

    pub(super) fn audit_lines(&self) -> Vec<Value> {
        let path = self.dir.path().join("audit/computer/local/audit.jsonl");
        fs::read_to_string(path)
            .expect("the hand's audit file")
            .lines()
            .map(|line| serde_json::from_str(line).expect("an audit line is JSON"))
            .collect()
    }

    /// Every byte the engine wrote under its roots (audit, markers, artifacts).
    pub(super) fn everything_written(&self) -> String {
        let mut text = String::new();
        let mut stack = vec![self.dir.path().to_owned()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(dir).expect("readable").filter_map(Result::ok) {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if let Ok(bytes) = fs::read(&path) {
                    text.push_str(&String::from_utf8_lossy(&bytes));
                }
            }
        }
        text
    }
}

pub(super) fn open(mut session: Session) -> Session {
    session.open(params(json!({}))).expect("open");
    session.stop_path_start(params(json!({})));
    session
}

type OnInput =
    Box<dyn FnMut(&mut FakeBackend, &TaggedInput, Route) -> BackendResult<Delivered> + Send>;

/// A fake backend whose `post_input` runs `on_input` and whose captures are counted.
pub(super) struct Probe {
    pub(super) inner: FakeBackend,
    on_input: OnInput,
    pub(super) captures: Arc<AtomicU32>,
}

impl Probe {
    pub(super) fn new(inner: FakeBackend, on_input: OnInput) -> Self {
        Self {
            inner,
            on_input,
            captures: Arc::default(),
        }
    }
}

impl Backend for Probe {
    fn capabilities(&self) -> Capabilities {
        self.inner.capabilities()
    }

    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.inner.windows(filter)
    }

    fn displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        self.inner.displays()
    }

    fn capture(&mut self, target: &Target, options: &CaptureOptions) -> BackendResult<FrameBytes> {
        self.captures.fetch_add(1, Ordering::SeqCst);
        self.inner.capture(target, options)
    }

    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        (self.on_input)(&mut self.inner, input, route)
    }

    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        self.inner.stop_listener()
    }

    fn probe_permissions(&self) -> PermissionProbe {
        self.inner.probe_permissions()
    }

    fn epoch_source(&mut self) -> Box<dyn EpochSource> {
        self.inner.epoch_source()
    }

    fn presence(&mut self) -> Option<Box<dyn Presence>> {
        self.inner.presence()
    }
}
