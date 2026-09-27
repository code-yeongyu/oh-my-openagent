//! The desktop session: one `senpi-desktop-session` thread owns the backend,
//! the AX ref registry, and the capture frame cache, and serves requests in
//! submission order. Each request runs under `catch_unwind` and its waiter
//! gives up at the injected [`SessionTimeouts`] deadline. Every mutating
//! request passes one choke point (`mutate`): the safety gate, a focus/cursor
//! transaction, and one audit event to [`SessionSafety::audit`].

mod audit;
mod budget;
mod mutate;
mod pointer;
mod request;
mod restore;
mod selection;
mod session;
#[cfg(test)]
mod test_support;
mod timeouts;
mod worker;
mod worker_ax;
mod worker_capture;
mod worker_input;

pub use mutate::SessionSafety;
pub use request::{Op, Response};
pub use selection::{BackendFactory, BackendSelection, SelectionError};
pub use session::{Pending, Session, THREAD_NAME};
pub use timeouts::{SessionTimeouts, CLOSE_TIMEOUT, OPERATION_TIMEOUT};
