//! Fail-closed supervisor, stop-path registry, and the ordered input gate for
//! desktop input.

mod action;
mod clock;
mod gate;
mod reset;
mod stop_path;
mod supervisor;

pub use action::MutatingAction;
pub use clock::{Clock, FakeClock, MonotonicClock};
pub use gate::{gate, FrameContext, FrameId, GateError, LockState, PermissionGate, StopPathReason};
pub use reset::{ResumeToken, UserReset};
pub use stop_path::{Chord, HostRelay, StopPathError, StopPathListener};
pub use supervisor::{
    ActiveStopPath, StopPathId, StopPolicy, StopSource, Supervisor, SupervisorStatus, HEARTBEAT_FRESH_MS,
    HEARTBEAT_INTERVAL_MS,
};
