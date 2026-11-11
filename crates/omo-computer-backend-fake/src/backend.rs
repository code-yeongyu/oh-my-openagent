//! `FakeBackend`: a scripted backend over one scenario, its sink, clock and persona.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use omo_computer_core::backend::BackendResult;

use crate::clock::FakeClock;
use crate::faults::Fault;
use crate::method::FakeMethod;
use crate::persona::Persona;
use crate::scenario::{FakeScenario, ScenarioInvalid};
use crate::sink::RecordingSink;
use crate::state::{CallOutcome, FakeState};
use crate::timeline::{self, LoadingState};

/// How the fake's stop listener behaves (`OMO_COMPUTER_FAKE_STOP_PATH`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum StopPathScript {
    /// No listener: `stop_listener()` refuses `no_listener`.
    #[default]
    None,
    /// A listener that hears the scripted stop chord.
    Live,
    /// A listener that exists but hears nothing.
    Deaf,
}

pub struct FakeBackend {
    pub(crate) shared: Arc<Mutex<FakeState>>,
    pub(crate) sink: RecordingSink,
    pub(crate) clock: FakeClock,
    pub(crate) persona: Persona,
    pub(crate) stop_path: StopPathScript,
}

impl FakeBackend {
    /// A backend on a fresh clock at 0 and an in-memory sink.
    #[must_use]
    pub fn new(scenario: FakeScenario) -> Self {
        Self::with_parts(scenario, FakeClock::default(), RecordingSink::default())
    }

    /// A backend on the given clock (its creation time is the clock's current time) and sink.
    #[must_use]
    pub fn with_parts(scenario: FakeScenario, clock: FakeClock, sink: RecordingSink) -> Self {
        let persona = scenario.persona.unwrap_or_else(Persona::host);
        let state = FakeState::new(scenario, clock.now_ms());
        Self {
            shared: Arc::new(Mutex::new(state)),
            sink,
            clock,
            persona,
            stop_path: StopPathScript::default(),
        }
    }

    /// # Errors
    /// The scenario is invalid; no backend is built.
    pub fn from_json(json: &str) -> Result<Self, ScenarioInvalid> {
        FakeScenario::from_json(json).map(Self::new)
    }

    #[must_use]
    pub const fn with_persona(mut self, persona: Persona) -> Self {
        self.persona = persona;
        self
    }

    #[must_use]
    pub const fn with_stop_path(mut self, stop_path: StopPathScript) -> Self {
        self.stop_path = stop_path;
        self
    }

    #[must_use]
    pub const fn persona(&self) -> Persona {
        self.persona
    }

    #[must_use]
    pub fn sink(&self) -> RecordingSink {
        self.sink.clone()
    }

    #[must_use]
    pub fn clock(&self) -> FakeClock {
        self.clock.clone()
    }

    pub(crate) fn lock(&self) -> MutexGuard<'_, FakeState> {
        self.shared.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Queues `fault` for the next call of `method`, behind any already queued.
    pub fn inject(&mut self, method: FakeMethod, fault: Fault) {
        self.lock().faults.push(method, fault);
    }

    /// How often `method` ran.
    #[must_use]
    pub fn calls(&self, method: FakeMethod) -> u32 {
        self.lock().calls.count(method)
    }

    /// The loading indicator of `window` at the clock's current time.
    #[must_use]
    pub fn loading_state(&self, window: &str) -> LoadingState {
        let state = self.lock();
        timeline::loading_state(
            &state.scenario.busy_timeline,
            window,
            state.elapsed(&self.clock),
        )
    }

    /// Runs one counted call: fault check, body, then the scripts keyed on its end.
    pub(crate) fn call<T>(
        &self,
        method: FakeMethod,
        body: impl FnOnce(&mut FakeState, CallOutcome) -> BackendResult<T>,
    ) -> BackendResult<T> {
        let mut state = self.lock();
        let result = state
            .begin_call(method, &self.clock)
            .and_then(|outcome| body(&mut state, outcome));
        state.end_call(method);
        result
    }
}
