//! The mutate funnel, pre-input marker, audit, refs registry, settle, frames, consent and verbs.

#[cfg(test)]
mod a_is_64_tests;
pub mod apps;
pub mod attribution;
pub mod audit;
pub mod batch;
pub mod budget;
mod clocked;
pub mod consent;
pub mod diff;
mod displays;
pub mod epoch;
pub mod frames;
pub mod grant;
mod held;
pub mod holds;
pub mod host_view;
pub mod intervention;
pub mod lease;
pub mod liveness;
pub mod lock;
pub mod marker;
pub mod menus;
pub mod mutate;
pub mod observe;
pub mod pause;
mod pointer;
pub mod presence;
pub mod preview;
pub mod diagnose_wire;
pub mod recording;
mod redaction;
pub mod refs;
pub mod route_ladder;
pub mod reservation;
pub mod surfaces;
mod send_on_enter;
mod session;
pub mod session_state;
pub mod settle;
#[cfg(test)]
mod test_process;
pub mod trace;
mod clipboard;
pub(crate) mod value_verbs;
mod wait_for;
mod window_frame;
mod v1_reads;

pub use epoch::EpochChanged;
pub use frames::CapturedFrame;
pub use mutate::{Binding, Mutation, Refused, SecureInputProbe, SecureProbe, Stamps};
pub use refs::{RefRegistry, Unresolved};
pub use session::{legacy_capabilities, Session, NOT_OPEN, NO_GLOBAL_LISTENER, POINT_REQUIRED};
