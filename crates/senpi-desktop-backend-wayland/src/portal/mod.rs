//! xdg-desktop-portal plumbing shared by input, the stop path, and capture:
//! the one runtime, the RemoteDesktop session, and orphaned-token cleanup.

pub mod remote_desktop;
pub mod runtime;
pub mod token_cleanup;

pub use runtime::{portal_runtime, CLOSE_TIMEOUT};
