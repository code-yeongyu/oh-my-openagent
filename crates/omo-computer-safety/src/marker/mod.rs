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
        let committed = durable_rename(&temp, &self.path, dir);
        if committed.is_err() {
            // A refused or failed commit leaves no temp file behind (after a rename that
            // succeeded, the temp is already gone and this finds nothing).
            let _ = fs::remove_file(&temp);
        }
        committed
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

/// The marker's last step (d-safety.md: exclusive tmp, fsync, rename, directory fsync): the
/// rename made durable. Unix renames, then fsyncs the directory that holds the marker.
#[cfg(unix)]
fn durable_rename(temp: &Path, path: &Path, dir: &Path) -> io::Result<()> {
    fs::rename(temp, path)?;
    File::open(dir)?.sync_all()
}

/// Windows (amendment A-IS-60, its security read): the temp file was flushed before this call;
/// the directory handle opens first (backup semantics, write access), so an access or
/// filesystem failure surfaces before the marker changes (`commit` then removes the temp
/// file, so a refused commit leaves nothing behind); the rename is write-through; then
/// the directory is flushed, which is the step that makes the entry durable. Ok only when
/// every call succeeded; any failure is an error carrying its `GetLastError` code (no code
/// reads as "unsupported, skip"); a flush that fails after the rename leaves the marker in
/// place; the one directory handle closes on every path.
#[cfg(windows)]
fn durable_rename(temp: &Path, path: &Path, dir: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{
        CloseHandle, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FlushFileBuffers, GetVolumeInformationByHandleW, MoveFileExW,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, OPEN_EXISTING,
    };

    /// Closes the handle on every path.
    struct Owned(HANDLE);
    impl Drop for Owned {
        fn drop(&mut self) {
            // SAFETY: the handle came from a successful CreateFileW and is closed once, here.
            unsafe { CloseHandle(self.0) };
        }
    }

    let wide = |p: &Path| -> Vec<u16> {
        p.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    };
    let (directory, from, to) = (wide(dir), wide(temp), wide(path));
    // SAFETY: a NUL-terminated UTF-16 path that lives across the call; no security attributes
    // and no template handle.
    let handle = unsafe {
        CreateFileW(
            directory.as_ptr(),
            GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let directory = Owned(handle);
    // The filesystem is read from the directory's own handle, never from a drive letter, and
    // anything but NTFS or ReFS refuses before any state changes.
    let mut name = [0_u16; 64];
    // SAFETY: the handle is open; only the filesystem-name buffer is asked for, with its length.
    let read = unsafe {
        GetVolumeInformationByHandleW(
            directory.0,
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            name.as_mut_ptr(),
            u32::try_from(name.len()).unwrap_or(0),
        )
    };
    let filesystem = if read == 0 {
        Err(io::Error::last_os_error())
    } else {
        let end = name.iter().position(|unit| *unit == 0).unwrap_or(name.len());
        Ok(String::from_utf16_lossy(&name[..end]))
    };
    admit_filesystem(filesystem)?;
    // SAFETY: both arguments are NUL-terminated UTF-16 paths that live across the call.
    let moved = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: the directory handle is open until \`directory\` drops.
    if unsafe { FlushFileBuffers(directory.0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// The filesystem a Windows stop marker may be committed on: NTFS or ReFS, the two whose
/// directory flush the arm relies on. Anything else, or a name that could not be read, is an
/// error naming what was read: an Ok the arm cannot back would be fail-open.
#[cfg(any(windows, test))]
fn admit_filesystem(read: io::Result<String>) -> io::Result<()> {
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

/// Any other target has no durable rename this crate knows: the marker cannot be committed.
#[cfg(not(any(unix, windows)))]
fn durable_rename(_temp: &Path, _path: &Path, _dir: &Path) -> io::Result<()> {
    Err(io::Error::other("no durable rename on this target"))
}

#[cfg(unix)]
fn euid() -> u32 {
    // SAFETY: geteuid has no preconditions and cannot fail.
    unsafe { libc::geteuid() }
}

#[cfg(test)]
mod tests;
