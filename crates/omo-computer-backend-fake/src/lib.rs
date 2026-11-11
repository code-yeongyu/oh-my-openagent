//! Scripted scenarios, recording sink, timelines and fault injection for the tests.

mod backend;
mod clock;
mod faults;
mod method;
mod persona;
mod scenario;
mod sink;
mod time_guard;
mod timeline;

pub use backend::FakeBackend;
pub use clock::FakeClock;
pub use faults::Fault;
pub use method::FakeMethod;
pub use persona::Persona;
pub use scenario::{FakeScenario, InvalidKind, ScenarioInvalid};
pub use sink::RecordingSink;
pub use timeline::LoadingState;
