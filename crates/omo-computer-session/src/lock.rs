//! `InteractionLock`: the machine-wide input lock under the fixed per-user RUNTIME root.
//! Every engine process of the user takes it exclusively around its input dispatch, so two
//! engines never interleave input, in any process or logon session of the user (A-IS-65 L1).
//! It is taken through the session crate's one file-lock helper (`file`): `flock` on unix,
//! the OS file lock on Windows, on a handle of its own per acquire, released when the guard
//! drops or the process dies. A failure to create, open or lock the file is an error, and the
//! funnel refuses with nothing sent (L2); a target with neither arm refuses the same way.
//!
//! The funnel's contract (ruling R70cp(1)): a backend's foreground restore completes BEFORE its
//! send call returns to the funnel, so the guard's drop after the send is a drop after the
//! restore and the lock is held through activate, act and restore (L1). A backend that
//! restores later is a defect; the rows that build each OS's restore prove the hold with their
//! own test (DEFERRED-LEGS, L1).

use std::io;
use std::path::{Path, PathBuf};

#[cfg(any(windows, test))]
mod dacl;
#[cfg(test)]
mod dacl_tests;
#[cfg(windows)]
mod dir;
pub(crate) mod file;
#[cfg(test)]
mod process;

/// The lock file's name under the RUNTIME root.
pub const LOCK_FILE: &str = "interaction.lock";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InteractionLock {
    path: PathBuf,
}

/// Holds the lock until dropped.
#[derive(Debug)]
pub struct LockGuard {
    _held: file::Held,
}

impl InteractionLock {
    #[must_use]
    pub fn under(runtime: &Path) -> Self {
        Self {
            path: runtime.join(LOCK_FILE),
        }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Waits for the lock.
    ///
    /// # Errors
    /// The lock file cannot be opened or locked.
    pub fn acquire(&self) -> io::Result<LockGuard> {
        let held = file::lock(self.open()?)?;
        Ok(LockGuard { _held: held })
    }

    /// Takes the lock when it is free; `None` while another holder has it.
    ///
    /// # Errors
    /// The lock file cannot be opened or locked.
    pub fn try_acquire(&self) -> io::Result<Option<LockGuard>> {
        let held = file::try_lock(self.open()?)?;
        Ok(held.map(|held| LockGuard { _held: held }))
    }

    fn open(&self) -> io::Result<std::fs::File> {
        if let Some(dir) = self.path.parent() {
            // Windows: the lock directory carries L3's protected DACL, read back.
            #[cfg(windows)]
            dir::protected_dir(dir)?;
            #[cfg(not(windows))]
            crate::marker::private_dir(dir)?;
        }
        file::open(&self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interaction_lock_is_exclusive_across_holders_and_frees_on_drop() {
        let dir = tempfile::tempdir().expect("tempdir");
        let lock = InteractionLock::under(dir.path());
        let held = lock.acquire().expect("first holder");
        let second = InteractionLock::under(dir.path());
        assert!(
            second.try_acquire().expect("probe").is_none(),
            "a second holder waits"
        );
        drop(held);
        assert!(
            second.try_acquire().expect("probe").is_some(),
            "free after the first drops"
        );
        assert!(lock.path().ends_with(LOCK_FILE));
    }
}
