//! The ONE file-lock helper of the session crate (A-IS-65 L8): the open of a lock file, the
//! exclusive lock, the try-lock with its "held" mapping, and the guard that unlocks and then
//! closes. Every lock takes the `File` it locks, so one handle is never locked twice, and
//! every handle is opened fresh and non-inheritable (std opens with `O_CLOEXEC` / no handle
//! inheritance), so no child process holds or prolongs a lock.
//!
//! Unix: `flock` (never `fcntl`) on a 0600 `O_NOFOLLOW` file. Windows: std's `File::lock` /
//! `File::try_lock` (`LockFileEx` over the whole file) on a handle shared for read and write
//! only, never delete (L12), opened on a reparse point itself and refused unless it is a
//! regular file (L3) on a local NTFS or ReFS volume (L9). Any other target refuses (L1).

use std::fs::File;
use std::io;
use std::path::Path;

/// An exclusive lock on its own handle: dropping it unlocks, then closes the handle.
#[derive(Debug)]
pub struct Held {
    file: File,
}

impl Held {
    /// The locked handle (the audit writer appends through it on unix).
    #[cfg_attr(not(unix), allow(dead_code))]
    pub(crate) const fn file(&self) -> &File {
        &self.file
    }
}

impl Drop for Held {
    fn drop(&mut self) {
        if let Err(error) = os::unlock(&self.file) {
            eprintln!(
                "omo-computer-engine: warn lock released by the handle's close only: {error}"
            );
        }
    }
}

/// Opens (creating it if absent) the lock file at `path`.
///
/// # Errors
/// The file cannot be created or opened, or is not a lock file this helper may lock.
pub(crate) fn open(path: &Path) -> io::Result<File> {
    os::open(path)
}

/// Waits for the exclusive lock on `file`.
///
/// # Errors
/// The lock cannot be taken.
pub(crate) fn lock(file: File) -> io::Result<Held> {
    os::lock(&file)?;
    Ok(Held { file })
}

/// Takes the exclusive lock on `file` when it is free; `None` while another holder has it.
///
/// # Errors
/// Any failure but "held elsewhere".
pub(crate) fn try_lock(file: File) -> io::Result<Option<Held>> {
    Ok(os::try_lock(&file)?.then_some(Held { file }))
}

#[cfg(unix)]
mod os {
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::unix::fs::OpenOptionsExt;
    use std::os::unix::io::AsRawFd;
    use std::path::Path;

    pub(super) fn open(path: &Path) -> io::Result<File> {
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
    }

    fn flock(file: &File, operation: libc::c_int) -> io::Result<()> {
        // SAFETY: the descriptor is open for the call; flock has no other precondition.
        if unsafe { libc::flock(file.as_raw_fd(), operation) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    pub(super) fn lock(file: &File) -> io::Result<()> {
        flock(file, libc::LOCK_EX)
    }

    pub(super) fn try_lock(file: &File) -> io::Result<bool> {
        match flock(file, libc::LOCK_EX | libc::LOCK_NB) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(false),
            Err(error) => Err(error),
        }
    }

    pub(super) fn unlock(file: &File) -> io::Result<()> {
        flock(file, libc::LOCK_UN)
    }
}

#[cfg(windows)]
mod os {
    use std::fs::{File, OpenOptions, TryLockError};
    use std::io;
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::path::Path;

    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        FILE_SHARE_WRITE,
    };

    pub(super) fn open(path: &Path) -> io::Result<File> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        let meta = file.metadata()?;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 || !meta.is_file() {
            return Err(io::Error::other(format!(
                "{} is a reparse point or not a regular file",
                path.display()
            )));
        }
        // L9: the lock is relied on only on a local NTFS or ReFS volume, read from the handle.
        omo_computer_safety::durable::admit_volume(&file)?;
        Ok(file)
    }

    pub(super) fn lock(file: &File) -> io::Result<()> {
        file.lock()
    }

    pub(super) fn try_lock(file: &File) -> io::Result<bool> {
        match file.try_lock() {
            Ok(()) => Ok(true),
            Err(TryLockError::WouldBlock) => Ok(false),
            Err(TryLockError::Error(error)) => Err(error),
        }
    }

    pub(super) fn unlock(file: &File) -> io::Result<()> {
        file.unlock()
    }
}

#[cfg(not(any(unix, windows)))]
mod os {
    use std::fs::File;
    use std::io;
    use std::path::Path;

    fn unsupported() -> io::Error {
        io::Error::new(io::ErrorKind::Unsupported, "no file lock on this target")
    }

    pub(super) fn open(_path: &Path) -> io::Result<File> {
        Err(unsupported())
    }

    pub(super) fn lock(_file: &File) -> io::Result<()> {
        Err(unsupported())
    }

    pub(super) fn try_lock(_file: &File) -> io::Result<bool> {
        Err(unsupported())
    }

    pub(super) fn unlock(_file: &File) -> io::Result<()> {
        Err(unsupported())
    }
}
