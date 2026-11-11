//! `InteractionLock`: the machine-wide input lock under the fixed per-user RUNTIME root.
//! Every engine process of the uid takes it exclusively around its input dispatch, so two
//! engines never interleave input. An advisory `flock`, released when the guard drops or
//! the process dies.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

/// The lock file's name under the RUNTIME root.
pub const LOCK_FILE: &str = "interaction.lock";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InteractionLock {
    path: PathBuf,
}

/// Holds the lock until dropped.
#[derive(Debug)]
pub struct LockGuard {
    _file: File,
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
        let file = self.open()?;
        flock(&file, false)?;
        Ok(LockGuard { _file: file })
    }

    /// Takes the lock when it is free; `None` while another holder has it.
    ///
    /// # Errors
    /// The lock file cannot be opened or locked.
    pub fn try_acquire(&self) -> io::Result<Option<LockGuard>> {
        let file = self.open()?;
        match flock(&file, true) {
            Ok(()) => Ok(Some(LockGuard { _file: file })),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(None),
            Err(error) => Err(error),
        }
    }

    fn open(&self) -> io::Result<File> {
        if let Some(dir) = self.path.parent() {
            crate::marker::private_dir(dir)?;
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        options.open(&self.path)
    }
}

#[cfg(unix)]
fn flock(file: &File, nonblocking: bool) -> io::Result<()> {
    use std::os::unix::io::AsRawFd;
    let operation = libc::LOCK_EX | if nonblocking { libc::LOCK_NB } else { 0 };
    // SAFETY: the descriptor is open for the call; flock has no other precondition.
    let status = unsafe { libc::flock(file.as_raw_fd(), operation) };
    if status == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn flock(_file: &File, _nonblocking: bool) -> io::Result<()> {
    // The Windows named-object lock is the Windows lane's (row 60); a file open is enough here.
    Ok(())
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
