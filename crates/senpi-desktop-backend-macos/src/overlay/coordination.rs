//! First helper-window publication holds a shared lock; capture holds the exclusive lock.
//! Separate processes use separate file handles, and exit releases the locks.
use std::fs::{File, OpenOptions, TryLockError};
use std::ffi::{CStr, OsStr};
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// A waiting capture must outlast the longest single hold of the lock: the SCK
/// worker's in-lock budget (at most 6 s, `capture::sck::IN_LOCK_MAX`) or a
/// filtered legacy capture (5 s); a fallback re-acquires the lock instead of
/// adding to a hold. Concurrent captures then queue instead of failing, and a
/// wedged helper still fails captures within a bound. First helper
/// publication holds the lock only briefly.
pub(super) const CAPTURE_WAIT: Duration = Duration::from_secs(8);
const RETRY_INTERVAL: Duration = Duration::from_millis(20);

pub(crate) fn path() -> io::Result<PathBuf> {
    let mut buffer = [0u8; 1024];
    // SAFETY: confstr writes at most buffer.len() bytes into this initialized,
    // exclusively borrowed stack buffer and retains no pointer after returning.
    let length = unsafe {
        libc::confstr(libc::_CS_DARWIN_USER_CACHE_DIR, buffer.as_mut_ptr().cast(), buffer.len())
    };
    if length == 0 {
        return Err(io::Error::last_os_error());
    }
    let bytes = buffer.get(..length).ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidData, "account cache path exceeds the OS path buffer")
    })?;
    let cache = CStr::from_bytes_with_nul(bytes).map_err(io::Error::other)?;
    // Darwin's private per-account cache does not use HOME/TMPDIR overrides,
    // and remains writable when the account's home cache is read-only.
    Ok(Path::new(OsStr::from_bytes(cache.to_bytes())).join("omo/cursor-overlay.lock"))
}

pub(super) fn open(path: &Path) -> io::Result<File> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    OpenOptions::new().read(true).write(true).create(true).truncate(false).mode(0o600).open(path)
}

pub(super) fn visible(file: File) -> io::Result<Option<File>> {
    match file.try_lock_shared() {
        Ok(()) => Ok(Some(file)),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(error)) => Err(error),
    }
}

pub(super) fn capture(file: File, wait: impl FnMut(Duration)) -> io::Result<File> {
    capture_for(file, wait, CAPTURE_WAIT)
}

/// `capture` with an explicit wait limit.
pub(super) fn capture_for(file: File, mut wait: impl FnMut(Duration), limit: Duration) -> io::Result<File> {
    let deadline = Instant::now() + limit;
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(TryLockError::WouldBlock) => {
                let now = Instant::now();
                if now >= deadline {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        format!(
                            "another capture or visible cursor helper retained the lock for {} ms",
                            limit.as_millis()
                        ),
                    ));
                }
                wait((deadline - now).min(RETRY_INTERVAL));
            }
            Err(TryLockError::Error(error)) => return Err(error),
        }
    }
}

#[cfg(test)]
#[path = "coordination_tests.rs"]
mod tests;
