//! The fake backend.

use omo_computer_core::backend::{AxBackend, Backend};

use crate::{
    FakeClock, FakeMethod, FakeScenario, Fault, LoadingState, Persona, RecordingSink,
    ScenarioInvalid,
};

pub struct FakeBackend {
    sink: RecordingSink,
    clock: FakeClock,
}

impl FakeBackend {
    #[must_use]
    pub fn new(scenario: FakeScenario) -> Self {
        let _ = scenario;
        Self {
            sink: RecordingSink::default(),
            clock: FakeClock::default(),
        }
    }

    /// # Errors
    /// The scenario is invalid.
    pub fn from_json(json: &str) -> Result<Self, ScenarioInvalid> {
        FakeScenario::from_json(json).map(Self::new)
    }

    #[must_use]
    pub fn with_persona(self, persona: Persona) -> Self {
        let _ = persona;
        self
    }

    #[must_use]
    pub fn sink(&self) -> RecordingSink {
        self.sink.clone()
    }

    #[must_use]
    pub fn clock(&self) -> FakeClock {
        self.clock.clone()
    }

    pub fn inject(&mut self, method: FakeMethod, fault: Fault) {
        let _ = (method, fault);
    }

    #[must_use]
    pub fn loading_state(&self, window: &str) -> LoadingState {
        let _ = window;
        LoadingState::Idle
    }
}

impl Backend for FakeBackend {}

impl AxBackend for FakeBackend {}
