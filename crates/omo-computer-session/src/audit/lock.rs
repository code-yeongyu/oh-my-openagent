//! The hand's lock, `<auditDir>/computer/<handId>/audit.lock` (A-IS-62 R7-3): 0600, never renamed,
//! held by every writer and every reader of the hand's audit for the whole of its write, size check,
//! rotation or read. It is taken through the crate's one lock helper, `crate::lock::flock` (R70cj).

use std::fs::{File, OpenOptions};
use std::io;
use std::path::Path;

pub const LOCK_FILE: &str = "audit.lock";

/// The held lock; it is released when dropped.
#[derive(Debug)]
pub struct HandLock {
    _file: File,
}

impl HandLock {
    /// Opens (creating it 0600 when missing) and takes the lock of the hand at `hand_dir`.
    ///
    /// # Errors
    /// The lock file cannot be opened, is not a regular file, or cannot be locked.
    pub fn take(hand_dir: &Path) -> io::Result<Self> {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let file = options.open(hand_dir.join(LOCK_FILE))?;
        if !file.metadata()?.is_file() {
            return Err(io::Error::other("the hand's audit lock is not a regular file"));
        }
        crate::lock::flock(&file, false)?;
        Ok(Self { _file: file })
    }
}
