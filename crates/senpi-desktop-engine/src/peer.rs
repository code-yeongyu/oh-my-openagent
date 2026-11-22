//! Who may be on the other end of a `--serve` unix socket (#12229, B1).
//!
//! - The endpoint directory rule, applied by the daemon and by every client
//!   before it binds, connects or auto-starts: the endpoint's parent is not a
//!   symlink, is owned by the caller's euid and has no group or other bits;
//!   its parent (the grandparent) is owned by the euid or root and is not
//!   group- or other-writable unless sticky. The parent is checked through a
//!   directory fd, and on Linux every later operation goes through that fd
//!   (`/proc/self/fd/<n>/<name>`); macOS has no fd-relative bind or connect,
//!   so there the path is used after the fd check.
//! - The peer credential check on a connected socket (`SO_PEERCRED` on Linux,
//!   `getpeereid` on macOS/BSD): the daemon closes a client whose euid is not
//!   its own, and a client closes a socket its own euid does not serve.

use std::ffi::{OsStr, OsString};
use std::fmt;
use std::fs::File;
use std::io;
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

/// A refusal under the endpoint or peer rule. A client never auto-starts a
/// daemon after one.
#[derive(Debug)]
pub struct Refused(pub String);

impl fmt::Display for Refused {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for Refused {}

pub fn refused(message: String) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, Refused(message))
}

pub fn is_refusal(error: &io::Error) -> bool {
    error.get_ref().is_some_and(|inner| inner.is::<Refused>())
}

pub fn euid() -> u32 {
    // SAFETY: geteuid has no preconditions and cannot fail.
    unsafe { libc::geteuid() }
}

/// The effective uid of the process on the other end of the connected unix
/// socket `fd`.
///
/// # Errors
/// The kernel did not report the peer's credentials.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub fn peer_euid(fd: RawFd) -> io::Result<u32> {
    let mut credentials = libc::ucred { pid: 0, uid: 0, gid: 0 };
    let mut length = libc::socklen_t::try_from(std::mem::size_of::<libc::ucred>()).map_err(io::Error::other)?;
    // SAFETY: `credentials` and `length` are valid for writes of the sizes passed.
    let status = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            std::ptr::from_mut(&mut credentials).cast(),
            &raw mut length,
        )
    };
    if status != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(credentials.uid)
}

/// The effective uid of the process on the other end of the connected unix
/// socket `fd`.
///
/// # Errors
/// The kernel did not report the peer's credentials.
#[cfg(not(any(target_os = "linux", target_os = "android")))]
pub fn peer_euid(fd: RawFd) -> io::Result<u32> {
    let mut uid: libc::uid_t = 0;
    let mut gid: libc::gid_t = 0;
    // SAFETY: `uid` and `gid` are valid for writes.
    let status = unsafe { libc::getpeereid(fd, &raw mut uid, &raw mut gid) };
    if status != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(uid)
}

/// Refuses unless the peer of `fd` runs as `expected` (`lookup` reads it).
///
/// # Errors
/// [`Refused`] on a different uid or a failed lookup (fail closed).
pub fn require_peer(fd: RawFd, expected: u32, lookup: impl Fn(RawFd) -> io::Result<u32>) -> io::Result<()> {
    match lookup(fd) {
        Ok(uid) if uid == expected => Ok(()),
        Ok(uid) => Err(refused(format!("the peer runs as uid {uid}, not {expected}"))),
        Err(error) => Err(refused(format!("the peer's credentials are unavailable: {error}"))),
    }
}

/// The endpoint's parent directory, opened and checked under the rule.
pub struct EndpointDir {
    dir: File,
    path: PathBuf,
    name: OsString,
}

impl EndpointDir {
    /// Opens `endpoint`'s parent with `O_DIRECTORY|O_NOFOLLOW` and applies the
    /// rule to it (through the fd) and to its parent.
    ///
    /// # Errors
    /// [`Refused`] when the rule fails or the directory cannot be opened.
    pub fn open(endpoint: &Path) -> io::Result<Self> {
        let Some(name) = endpoint.file_name() else {
            return Err(refused(format!("{}: the endpoint names no socket file", endpoint.display())));
        };
        let path = match endpoint.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
            _ => PathBuf::from("."),
        };
        let shown = path.display().to_string();
        let dir = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&path)
            .map_err(|error| refused(format!("{shown}: cannot open the endpoint directory: {error}")))?;
        let parent = dir.metadata()?;
        let me = euid();
        if parent.uid() != me {
            return Err(refused(format!("{shown} is owned by uid {}, not {me}", parent.uid())));
        }
        if parent.mode() & 0o077 != 0 {
            return Err(refused(format!(
                "{shown} has mode {:o}; the endpoint directory must not be accessible to group or other",
                parent.mode() & 0o7777
            )));
        }
        let opened = Self {
            dir,
            path,
            name: name.to_owned(),
        };
        let grandparent = std::fs::metadata(opened.entry(OsStr::new("..")))
            .map_err(|error| refused(format!("{shown}/..: {error}")))?;
        let sticky = grandparent.mode() & 0o1000 != 0;
        if grandparent.uid() != me && grandparent.uid() != 0 {
            return Err(refused(format!("{shown}/.. is owned by uid {}", grandparent.uid())));
        }
        if grandparent.mode() & 0o022 != 0 && !sticky {
            return Err(refused(format!(
                "{shown}/.. is writable by group or other and not sticky (mode {:o})",
                grandparent.mode() & 0o7777
            )));
        }
        Ok(opened)
    }

    /// A path to `name` inside the checked directory: through the directory
    /// fd on Linux, by path after the fd check elsewhere.
    pub fn entry(&self, name: &OsStr) -> PathBuf {
        if cfg!(any(target_os = "linux", target_os = "android")) {
            Path::new("/proc/self/fd")
                .join(self.dir.as_raw_fd().to_string())
                .join(name)
        } else {
            self.path.join(name)
        }
    }

    pub fn socket(&self) -> PathBuf {
        self.entry(&self.name)
    }

    /// `name` with `extension` in place of the socket's (`e.sock` -> `e.resume`).
    pub fn sibling(&self, extension: &str) -> OsString {
        Path::new(&self.name).with_extension(extension).into_os_string()
    }
}

/// `(device, inode)` of the entry at `path`, not following a symlink.
///
/// # Errors
/// The entry does not exist or cannot be read.
pub fn identity(path: &Path) -> io::Result<(u64, u64)> {
    std::fs::symlink_metadata(path).map(|meta| (meta.dev(), meta.ino()))
}
