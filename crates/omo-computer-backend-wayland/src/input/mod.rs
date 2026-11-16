//! libei input (RED skeleton).

use std::os::fd::RawFd;

/// The reconnect backoff steps (d-linux.md 'Connection lifecycle').
pub const RECONNECT_BACKOFF_MS: [u64; 3] = [250, 500, 1_000];

#[must_use]
pub const fn is_cloexec(_fd: RawFd) -> bool {
    false
}
