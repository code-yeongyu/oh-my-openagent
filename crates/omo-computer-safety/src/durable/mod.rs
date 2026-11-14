//! Durable directory-entry writes, the last step of every marker write (d-safety.md:145:
//! exclusive tmp, fsync, rename, dir fsync): ONE helper for the stop marker and the pre-input
//! marker, so no OS skips the directory step (ruling R70z(3), R70ch(1)). Unix renames and
//! fsyncs the directory; Windows makes the rename and the directory durable through the
//! directory's own handle (see `windows`); any other target refuses.

use std::io;
#[cfg(not(windows))]
use std::path::Path;

#[cfg(windows)]
mod windows;

#[cfg(windows)]
pub use windows::{durable_rename, sync_dir};

/// Renames `temp` over `path` in `dir`, then fsyncs `dir`.
///
/// # Errors
/// The rename or the directory fsync fails.
#[cfg(unix)]
pub fn durable_rename(temp: &Path, path: &Path, dir: &Path) -> io::Result<()> {
    std::fs::rename(temp, path)?;
    sync_dir(dir)
}

/// Fsyncs `dir`, making a create or removal in it durable.
///
/// # Errors
/// The directory cannot be opened or synced.
#[cfg(unix)]
pub fn sync_dir(dir: &Path) -> io::Result<()> {
    std::fs::File::open(dir)?.sync_all()
}

/// Any other target has no durable rename this crate knows: nothing is committed.
///
/// # Errors
/// Always.
#[cfg(not(any(unix, windows)))]
pub fn durable_rename(_temp: &Path, _path: &Path, _dir: &Path) -> io::Result<()> {
    Err(io::Error::other("no durable rename on this target"))
}

/// Any other target cannot make a directory entry durable.
///
/// # Errors
/// Always.
#[cfg(not(any(unix, windows)))]
pub fn sync_dir(_dir: &Path) -> io::Result<()> {
    Err(io::Error::other("no durable directory sync on this target"))
}

/// The filesystem a Windows stop marker may be committed on: NTFS or ReFS, the two whose
/// directory flush the arm relies on. Anything else, or a name that could not be read, is an
/// error naming what was read: an Ok the arm cannot back would be fail-open.
#[cfg(any(windows, test))]
pub(crate) fn admit_filesystem(read: io::Result<String>) -> io::Result<()> {
    match read {
        Ok(name) if name == "NTFS" || name == "ReFS" => Ok(()),
        Ok(name) => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            UnsupportedFilesystem { name },
        )),
        Err(error) => Err(io::Error::new(
            error.kind(),
            UnsupportedFilesystem {
                name: format!("unreadable ({error})"),
            },
        )),
    }
}

/// The stop marker's filesystem is not one whose directory flush makes a rename durable.
#[cfg(any(windows, test))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnsupportedFilesystem {
    /// What the volume reported: its filesystem name, or why it could not be read.
    pub name: String,
}

#[cfg(any(windows, test))]
impl std::fmt::Display for UnsupportedFilesystem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "the stop marker's filesystem is {:?}, not NTFS or ReFS",
            self.name
        )
    }
}

#[cfg(any(windows, test))]
impl std::error::Error for UnsupportedFilesystem {}

