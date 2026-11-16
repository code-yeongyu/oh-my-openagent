//! The hand's lock, `<auditDir>/computer/<handId>/audit.lock` (A-IS-62 R7-3): 0600, never
//! renamed, taken through the session crate's one lock helper (`flock` on unix, the OS file lock
//! on Windows, A-IS-65 L8). Every writer holds it for each append, its size checks and a rotation;
//! every reader holds it for its read. It is a LEAF lock (A-IS-65 L6): while it is held no other
//! lock is taken.

use std::io;
use std::path::Path;

use crate::lock::file::{self, Held};

/// The hand's lock file, beside its audit files.
pub const LOCK_FILE: &str = "audit.lock";

/// The held hand lock; released when dropped.
#[derive(Debug)]
pub(crate) struct HandLock {
    _held: Held,
}

impl HandLock {
    /// Waits for the lock of the hand whose files are in `hand_dir`.
    ///
    /// # Errors
    /// The lock file cannot be created, opened or locked.
    pub(crate) fn take(hand_dir: &Path) -> io::Result<Self> {
        Ok(Self {
            _held: file::lock(file::open(&hand_dir.join(LOCK_FILE))?)?,
        })
    }
}
