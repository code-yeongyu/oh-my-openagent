//! The persisted stop marker `global-stop`: dir 0700, file 0600, owner-validated, opened
//! `O_NOFOLLOW`, committed by exclusive temp + fsync + rename + directory fsync. A marker that
//! is present OR unreadable starts the engine stopped. (The Windows ACL to the user SID is
//! row 60's.)

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

/// The marker's whole content.
pub const MARKER_CONTENT: &[u8] = b"omo-global-stop-v1\n";

/// What a read of the marker found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkerState {
    Absent,
    Present,
    /// A file is there and cannot be read as the marker (a symlink, a torn write, a foreign
    /// owner): read as stopped.
    Unreadable,
}

impl MarkerState {
    /// Whether the engine starts stopped.
    #[must_use]
    pub const fn stops(self) -> bool {
        !matches!(self, Self::Absent)
    }
}

/// Where the latch persists.
pub trait MarkerStore: Send {
    fn read(&self) -> MarkerState;

    /// Persists the marker; the caller exits 1 when this fails.
    ///
    /// # Errors
    /// The marker could not be written durably.
    fn commit(&mut self) -> io::Result<()>;

    /// The marker's path, when it has one.
    fn path(&self) -> Option<&Path>;
}

/// The marker file under the per-uid STATE root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileMarker {
    path: PathBuf,
}

impl FileMarker {
    #[must_use]
    pub const fn at(path: PathBuf) -> Self {
        Self { path }
    }
}

impl MarkerStore for FileMarker {
    fn read(&self) -> MarkerState {
        match open_no_follow(&self.path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => MarkerState::Absent,
            Err(_) => MarkerState::Unreadable,
            Ok(mut file) => {
                let mut content = Vec::new();
                let owned = owner_ok(&file);
                match file.read_to_end(&mut content) {
                    Ok(_) if owned && content == MARKER_CONTENT => MarkerState::Present,
                    _ => MarkerState::Unreadable,
                }
            }
        }
    }

    fn commit(&mut self) -> io::Result<()> {
        let dir = self
            .path
            .parent()
            .ok_or_else(|| io::Error::other("the marker path has no directory"))?;
        private_dir(dir)?;
        let temp = dir.join(format!(".global-stop.{}.tmp", std::process::id()));
        let written = write_exclusive(&temp);
        if let Err(error) = written {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
        fs::rename(&temp, &self.path)?;
        File::open(dir)?.sync_all()
    }

    fn path(&self) -> Option<&Path> {
        Some(&self.path)
    }
}

/// A marker that lives only in memory: an engine without a STATE root (the self-test and the
/// in-process tests). It still latches and reads back what it was told.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MemoryMarker {
    present: bool,
}

impl MemoryMarker {
    #[must_use]
    pub const fn present() -> Self {
        Self { present: true }
    }
}

impl MarkerStore for MemoryMarker {
    fn read(&self) -> MarkerState {
        if self.present {
            MarkerState::Present
        } else {
            MarkerState::Absent
        }
    }

    fn commit(&mut self) -> io::Result<()> {
        self.present = true;
        Ok(())
    }

    fn path(&self) -> Option<&Path> {
        None
    }
}

fn write_exclusive(temp: &Path) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    no_follow_private(&mut options);
    let mut file = options.open(temp)?;
    file.write_all(MARKER_CONTENT)?;
    file.sync_all()
}

#[cfg(unix)]
fn no_follow_private(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
}

#[cfg(not(unix))]
const fn no_follow_private(_options: &mut OpenOptions) {}

fn open_no_follow(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}

/// Creates the directory 0700 and checks it is a real directory the effective uid owns.
fn private_dir(dir: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)?;
    let meta = fs::symlink_metadata(dir)?;
    if !meta.is_dir() {
        return Err(io::Error::other("the marker directory is not a directory"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if meta.uid() != euid() {
            return Err(io::Error::other("the marker directory has another owner"));
        }
        if meta.mode() & 0o077 != 0 {
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn owner_ok(file: &File) -> bool {
    use std::os::unix::fs::MetadataExt;
    file.metadata()
        .is_ok_and(|meta| meta.uid() == euid() && meta.mode() & 0o077 == 0)
}

#[cfg(not(unix))]
fn owner_ok(_file: &File) -> bool {
    true
}

#[cfg(unix)]
fn euid() -> u32 {
    // SAFETY: geteuid has no preconditions and cannot fail.
    unsafe { libc::geteuid() }
}

#[cfg(test)]
mod tests;
