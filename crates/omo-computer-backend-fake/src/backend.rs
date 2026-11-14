//! `FakeBackend`: a scripted backend over one scenario, its sink, clock and persona.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use omo_computer_core::backend::BackendResult;
use omo_computer_core::error::UnknownFailure;

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

    /// Queues `fault` for the next call of `method`, behind any already queued. A `Fail`
    /// goes through the same error-table check as the scenario's `fail_next`.
    ///
    /// # Errors
    /// The `Fail` pair has no row in the COMPUTER_* table; nothing is queued.
    pub fn inject(&mut self, method: FakeMethod, fault: Fault) -> Result<(), UnknownFailure> {
        fault.check()?;
        self.lock().faults.push(method, fault);
        Ok(())
    }

    /// Another handle on this same fake (shared state, sink and clock): what a second thread
    /// presses the stop chord or reads call counts through.
    #[must_use]
    pub fn handle(&self) -> Self {
        Self {
            shared: Arc::clone(&self.shared),
            sink: self.sink.clone(),
            clock: self.clock.clone(),
            persona: self.persona,
            stop_path: self.stop_path,
        }
    }

    /// How many times a live stop listener of this fake was polled.
    #[must_use]
    pub fn stop_polls(&self) -> u32 {
        self.lock().stop_polls
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

// --- Row 21 (R70at(5)): test support, additive. A handle that changes the consent view the fake
// hands the engine mid-session; no scenario's behaviour changes unless a test uses it. ---

/// Changes the fake host's handed consent view (`scenario.consent`) from a test.
#[derive(Debug, Clone)]
pub struct FakeConsentHandle(Arc<Mutex<FakeState>>);

impl FakeConsentHandle {
    /// The view the next `session.open` reads.
    pub fn set(&self, view: serde_json::Value) {
        self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner).scenario.consent = Some(view);
    }
}

impl FakeBackend {
    /// A handle on this fake's handed consent view (test support, R70at(5)).
    #[must_use]
    pub fn consent_handle(&self) -> FakeConsentHandle {
        FakeConsentHandle(Arc::clone(&self.shared))
    }
}
