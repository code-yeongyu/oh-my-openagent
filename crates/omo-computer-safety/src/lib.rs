//! Gate order, supervisor, stop commit and latch, protected-target and dangerous-chord tables.
//!
//! Every refusal this crate emits is built from the closed `(EngineCode, Reason)` sets of the
//! core error table, before any OS call, with nothing sent.

#[macro_use]
mod refusal;

pub mod gate;
pub mod guard;
pub mod latch;
pub mod marker;
pub mod protected;
pub mod rearm;
pub mod resolve;
pub mod self_set;
pub mod stop_path;
pub mod supervisor;
pub mod timing;

#[cfg(test)]
mod session_sink_tests;

pub use gate::{gate, Admitted, DragPoint, Gate, GateFacts, GateRefusal, Tables, Tier, VerbKind};
pub use guard::{Call, Clock, Guard, MonotonicClock, Observed, OwnProcess, ProcessSource};
pub use latch::SuspendReason;
pub use marker::{FileMarker, MarkerState, MarkerStore, MemoryMarker};
pub use resolve::TargetRef;
pub use self_set::HostAdditions;
pub use stop_path::{StopPathFailure, StopPathKind, StopPathView, StopPolicy, Transport};
pub use supervisor::{Exit, Holds, NoHolds, ProcessExit, StopOutcome, Supervisor};
