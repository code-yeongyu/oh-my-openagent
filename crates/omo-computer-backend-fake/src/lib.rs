//! Scripted scenarios, recording sink, timelines and fault injection for the tests.
//!
//! The fake implements the `Backend` / `AxBackend` traits of `omo-computer-core` from one
//! scenario file. Every OS-level side effect is one line in the [`RecordingSink`]; time is the
//! [`FakeClock`] alone; each scenario runs under every [`Persona`].

mod ax;
mod ax_tree;
mod backend;
mod capabilities;
mod clock;
mod desktop;
mod faults;
mod frame;
mod handles;
mod method;
mod persona;
mod refusals;
mod scenario;
mod scripting;
mod seams;
mod sink;
mod state;
#[cfg(test)]
mod time_guard;
mod timeline;

pub use ax_tree::{NODES_PER_MS, PAD_ROLE};
pub use backend::{FakeBackend, StopPathScript};
pub use capabilities::BACKEND_NAME;
pub use clock::{ClockSeamInvalid, FakeClock, CLOCK_SEAM};
pub use faults::Fault;
pub use method::FakeMethod;
pub use persona::Persona;
pub use refusals::{bare, refusal_row, BARE_REASON};
pub use scenario::{
    field_names, fixtures_dir, AxNotification, BusyMark, ClipboardScript, DelayMs, DisplaysChange,
    EpochEvent, EpochReason, FakeAxNode, FakeDisplay, FakeMenuNode, FakeScenario, FakeWindow,
    FocusRead, FocusRecordKind, FocusRecordOutcome, FrameAxis, FramePolicy, HandIdentity,
    IdentityChange, InvalidKind, RemoteForwarding, ScenarioInvalid, ScriptedFailure, ScriptedHit,
    SecureFocus, TargetExit, TimedUserInput, UserInputKind, UserPress, WindowIdentityScript,
};
pub use scripting::{ClipboardRead, FocusReadResult, FrameResult};
pub use seams::{parse_stop_path, SeamError, SCENARIO_SEAM, STOP_PATH_SEAM};
pub use sink::RecordingSink;
pub use timeline::{LoadingState, UserInput};
