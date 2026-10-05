//! Scripted headless desktop backend for tests: serves displays, windows, and
//! accessibility trees from a JSON [`FakeScenario`], records every side effect
//! into a [`RecordingSink`], injects per-method failures and delays, and ships
//! a [`FakeClock`] for heartbeat tests. Touches no OS API.

mod ax_impl;
mod ax_tree;
mod clock;
mod desktop_impl;
mod fake;
mod faults;
mod method;
mod scenario;
mod sink;

pub use clock::FakeClock;
pub use fake::FakeBackend;
pub use faults::Faults;
pub use method::FakeMethod;
pub use scenario::{
    fake_capabilities, DelayMs, FakeAxNode, FakeBounds, FakeScenario, ResizeWindow, ScenarioError,
    ScriptedFailure,
};
pub use sink::{RecordedPointer, RecordingSink, SinkOp};
