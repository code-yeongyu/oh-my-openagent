//! Scripted headless desktop backend for tests: serves displays, windows, and
//! accessibility trees from a JSON [`FakeScenario`], records every side effect
//! into a [`RecordingSink`], injects per-method failures and delays, and ships
//! a [`FakeClock`] for heartbeat tests. Touches no OS API.

mod ax_impl;
mod ax_tree;
mod clock;
mod desktop_impl;
mod element_input_impl;
mod fake;
mod faults;
mod frames_impl;
mod holds_impl;
mod menus_impl;
mod method;
mod remote_impl;
mod scenario;
mod scenario_nodes;
mod sink;
mod user_input_impl;

pub use clock::FakeClock;
pub use fake::FakeBackend;
pub use faults::Faults;
pub use method::{AxWrite, FakeMethod};
pub use remote_impl::FakeRemoteScreen;
pub use scenario::{
    fake_capabilities, DelayMs, FakeAxNode, FakeBounds, FakeMenuNode, FakeScenario, ResizeWindow,
    ScenarioError, ScriptedFailure,
};
pub use sink::{RecordedPointer, RecordingSink, SinkOp};
pub use user_input_impl::{FakeUserInput, ScriptedPressKind, ScriptedUserPress};
