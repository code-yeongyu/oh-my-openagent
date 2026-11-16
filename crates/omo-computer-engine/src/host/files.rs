//! The two files a host-less engine reads from `<config>/computer/` (R70k D-1): every directory
//! is opened `O_DIRECTORY|O_NOFOLLOW` and checked on its descriptor (owner is the effective uid,
//! no group or other bits), and each child is reached through that descriptor with `openat`,
//! never by resolving the path again, so a symlink or rename between check and use cannot
//! substitute a directory. A check that fails reads as an unreadable latch, which is SET.

use std::ffi::CString;
use std::fs::File;
use std::io::{self, Read};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

use omo_computer_core::host_paths::HostPaths;
use serde_json::Value;

/// Larger than any latch or consent file a host writes; a bigger file is not one of them.
const MAX_FILE_BYTES: u64 = 64 * 1024;

pub fn euid() -> u32 {
    // SAFETY: geteuid has no preconditions and cannot fail.
    unsafe { libc::geteuid() }
}

/// What the persisted `host-latch` file says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LatchFile {
    Absent,
    Clear,
    Set,
    /// Present but not trustworthy: read as suspended, the way the host reads it.
    Unreadable(String),
}

impl LatchFile {
    pub fn audit(&self) -> Option<String> {
        match self {
            Self::Unreadable(why) => Some(format!("host_latch_unreadable:{why}")),
            _ => None,
        }
    }
}

fn checked(file: File, mode_bits_allowed: u32, what: &str) -> Result<File, String> {
    let meta = file.metadata().map_err(|e| format!("{what}_stat:{e}"))?;
    if meta.uid() != euid() {
        return Err(format!("{what}_owner"));
    }
    if meta.mode() & 0o777 & !mode_bits_allowed != 0 {
        return Err(format!("{what}_mode"));
    }
    Ok(file)
}

fn open_dir(path: &Path) -> io::Result<File> {
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
}

/// `openat(dir, name, flags | O_NOFOLLOW | O_CLOEXEC)`.
fn open_at(dir: &File, name: &str, flags: libc::c_int) -> io::Result<File> {
    let name = CString::new(name).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    // SAFETY: the descriptor is live for the call and the name is NUL-terminated.
    let fd = unsafe { libc::openat(dir.as_raw_fd(), name.as_ptr(), flags | libc::O_NOFOLLOW | libc::O_CLOEXEC) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: openat returned a fresh descriptor this File now owns alone.
    Ok(unsafe { File::from_raw_fd(fd) })
}

/// The `computer/` directory, `None` when it does not exist.
fn computer_dir(paths: &HostPaths, strict: bool) -> Result<Option<File>, String> {
    let allowed = if strict { 0o700 } else { 0o777 };
    let config = open_dir(&paths.config).map_err(|e| format!("config_dir:{e}"))?;
    let config = checked(config, allowed, "config_dir")?;
    match open_at(&config, "computer", libc::O_RDONLY | libc::O_DIRECTORY) {
        Ok(dir) => checked(dir, allowed, "computer_dir").map(Some),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("computer_dir:{e}")),
    }
}

fn read_child(dir: &File, name: &str) -> Result<Option<Vec<u8>>, String> {
    let file = match open_at(dir, name, libc::O_RDONLY) {
        Ok(file) => checked(file, 0o600, name)?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{name}:{e}")),
    };
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("{name}_read:{e}"))?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_FILE_BYTES {
        return Err(format!("{name}_size"));
    }
    Ok(Some(bytes))
}

pub fn read_latch(paths: &HostPaths) -> LatchFile {
    let bytes = match computer_dir(paths, true).and_then(|dir| match dir {
        Some(dir) => read_child(&dir, "host-latch"),
        None => Ok(None),
    }) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => return LatchFile::Absent,
        Err(why) => return LatchFile::Unreadable(why),
    };
    match serde_json::from_slice::<Value>(&bytes).ok().and_then(|v| v["suspended"].as_bool()) {
        Some(true) => LatchFile::Set,
        Some(false) => LatchFile::Clear,
        None => LatchFile::Unreadable("host_latch_parse".to_owned()),
    }
}

/// The hand's `consent.json`: `Ok(None)` when absent, `Err` when present but not trustworthy
/// (wrong owner or mode, a symlink, unparseable), which the caller reads as `tampered`.
///
/// # Errors
/// Why the file cannot be trusted.
pub fn read_consent(paths: &HostPaths) -> Result<Option<Value>, String> {
    let Some(dir) = computer_dir(paths, false)? else {
        return Ok(None);
    };
    read_child(&dir, "consent.json")?
        .map(|bytes| serde_json::from_slice(&bytes).map_err(|e| format!("consent_parse:{e}")))
        .transpose()
}
