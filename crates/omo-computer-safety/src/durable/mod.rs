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
pub use windows::{admit_volume, durable_rename, sync_dir};

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

/// What a Windows marker or lock relies on about its volume: the filesystem's name and
/// whether the volume is a remote device.
#[cfg(any(windows, test))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Volume {
    pub filesystem: String,
    pub remote: bool,
}

/// The volume a Windows stop marker, pre-input marker or lock may rely on: a LOCAL volume
/// whose filesystem is NTFS or ReFS, the two whose directory flush and byte-range locks the
/// arms rely on (A-IS-65 L9). Anything else, or a volume that could not be read, is an error
/// naming what was read: an Ok the arm cannot back would be fail-open.
#[cfg(any(windows, test))]
pub(crate) fn admit_filesystem(read: io::Result<Volume>) -> io::Result<()> {
    match read {
        Ok(volume)
            if !volume.remote && (volume.filesystem == "NTFS" || volume.filesystem == "ReFS") =>
        {
            Ok(())
        }
        Ok(volume) => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            UnsupportedFilesystem {
                name: volume.filesystem,
                remote: volume.remote,
            },
        )),
        Err(error) => Err(io::Error::new(
            error.kind(),
            UnsupportedFilesystem {
                name: format!("unreadable ({error})"),
                remote: false,
            },
        )),
    }
}

/// The volume is not a local NTFS or ReFS volume.
#[cfg(any(windows, test))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnsupportedFilesystem {
    /// What the volume reported: its filesystem name, or why it could not be read.
    pub name: String,
    /// The volume is a remote device.
    pub remote: bool,
}

#[cfg(any(windows, test))]
impl std::fmt::Display for UnsupportedFilesystem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let place = if self.remote { "a remote" } else { "a local" };
        write!(
            f,
            "the volume's filesystem is {:?} on {place} device, not NTFS or ReFS on a local one",
            self.name
        )
    }
}

#[cfg(any(windows, test))]
impl std::error::Error for UnsupportedFilesystem {}
